import { AxiosInstance, AxiosResponse, AxiosError } from 'axios';
import winston from 'winston';
import { v4 as uuidv4 } from 'uuid';
import {
  AutotaskError,
  createAutotaskError,
  isRetryableError,
  getRetryDelay,
} from './errors';
import { CircuitBreakerError } from '../errors/AutotaskErrors';
import { PerformanceMonitor } from './performanceMonitor';
import { RetryStrategy, RetryOptions } from '../errors/RetryStrategy';
import {
  CircuitBreaker,
  CircuitBreakerOptions,
  CircuitBreakerRegistry,
  CircuitBreakerState
} from '../errors/CircuitBreaker';
import { ErrorLogger, LogContext, defaultErrorLogger } from '../errors/ErrorLogger';

/**
 * Limits concurrent requests per endpoint to respect Autotask's 3-thread-per-endpoint
 * constraint (per API tracking identifier). Queues excess requests rather than rejecting them.
 *
 * See: https://autotask.net/help/DeveloperHelp/Content/AdminSetup/2ExtensionsIntegrations/APIs/REST/API_Rate_Limiting.htm
 */
class EndpointSemaphore {
  private active = new Map<string, number>();
  private queues = new Map<string, Array<() => void>>();

  constructor(private readonly limit: number = 3) {}

  async acquire(endpoint: string): Promise<void> {
    const current = this.active.get(endpoint) ?? 0;
    if (current < this.limit) {
      this.active.set(endpoint, current + 1);
      return;
    }
    return new Promise<void>(resolve => {
      const queue = this.queues.get(endpoint) ?? [];
      queue.push(resolve);
      this.queues.set(endpoint, queue);
    });
  }

  release(endpoint: string): void {
    const queue = this.queues.get(endpoint) ?? [];
    if (queue.length > 0) {
      // Pass the slot directly to the next waiter without changing the count
      const next = queue.shift()!;
      this.queues.set(endpoint, queue);
      next();
    } else {
      this.active.set(endpoint, Math.max(0, (this.active.get(endpoint) ?? 1) - 1));
    }
  }

  queueLength(endpoint: string): number {
    return this.queues.get(endpoint)?.length ?? 0;
  }
}

export interface RequestOptions {
  retries?: number;
  baseDelay?: number;
  timeout?: number;
  enableRequestLogging?: boolean;
  enableResponseLogging?: boolean;
  requestId?: string;
  enablePerformanceMonitoring?: boolean;
  
  // Enhanced retry options
  retryStrategy?: RetryOptions;
  useAdvancedRetry?: boolean;
  
  // Circuit breaker options
  circuitBreaker?: CircuitBreakerOptions;
  enableCircuitBreaker?: boolean;
  circuitBreakerName?: string;
}

export interface RequestContext {
  requestId: string;
  endpoint: string;
  method: string;
  startTime: number;
  attempt: number;
}

/**
 * Enhanced request handler with structured error handling, retry logic, and logging
 */
export class RequestHandler {
  private defaultOptions: Required<Omit<RequestOptions, 'retryStrategy' | 'circuitBreaker' | 'circuitBreakerName'>> & {
    retryStrategy?: RetryOptions;
    circuitBreaker?: CircuitBreakerOptions;
    circuitBreakerName?: string;
  } = {
    retries: 3,
    baseDelay: 1000,
    timeout: 30000,
    enableRequestLogging: true,
    enableResponseLogging: true,
    requestId: '',
    enablePerformanceMonitoring: true,
    useAdvancedRetry: true,
    enableCircuitBreaker: true,
  };

  private performanceMonitor: PerformanceMonitor;
  private retryStrategy: RetryStrategy;
  private circuitBreakerRegistry: CircuitBreakerRegistry;
  private errorLogger: ErrorLogger;
  // Autotask enforces 3 concurrent threads per endpoint per API tracking identifier.
  // This semaphore queues excess requests to prevent HTTP 429 "thread limit exceeded" errors.
  private endpointSemaphore = new EndpointSemaphore(3);

  constructor(
    private axios: AxiosInstance,
    private logger: winston.Logger,
    private globalOptions: Partial<RequestOptions> = {},
    errorLogger?: ErrorLogger
  ) {
    this.errorLogger = errorLogger || defaultErrorLogger;
    this.performanceMonitor = new PerformanceMonitor(this.logger);
    this.retryStrategy = new RetryStrategy({
      maxRetries: this.defaultOptions.retries,
      initialDelay: this.defaultOptions.baseDelay,
      backoffMultiplier: 2,
      jitterFactor: 0.1,
      maxDelay: 30000,
    });
    this.circuitBreakerRegistry = CircuitBreakerRegistry.getInstance();
    this.setupAxiosInterceptors();
  }

  /**
   * Setup axios interceptors for request/response logging and timeout handling
   */
  private setupAxiosInterceptors(): void {
    // Request interceptor
    this.axios.interceptors.request.use(
      config => {
        // Add timeout if not already set
        if (!config.timeout && this.defaultOptions.timeout) {
          config.timeout = this.defaultOptions.timeout;
        }

        // Add request ID for tracking
        const requestId = uuidv4();
        config.metadata = { requestId, startTime: Date.now() };

        return config;
      },
      error => {
        this.logger.error('Request interceptor error:', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.axios.interceptors.response.use(
      response => {
        const duration =
          Date.now() - (response.config.metadata?.startTime || 0);
        response.metadata = {
          ...response.config.metadata,
          duration,
          success: true,
        };
        return response;
      },
      error => {
        const duration = Date.now() - (error.config?.metadata?.startTime || 0);
        if (error.config) {
          error.config.metadata = {
            ...error.config.metadata,
            duration,
            success: false,
          };
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * Execute a request with enterprise-grade reliability patterns.
   * Automatically limits concurrent requests per endpoint to 3 (Autotask's hard limit).
   */
  async executeRequest<T>(
    requestFn: () => Promise<AxiosResponse<T>>,
    endpoint: string,
    method: string,
    options: RequestOptions = {}
  ): Promise<AxiosResponse<T>> {
    const mergedOptions = {
      ...this.defaultOptions,
      ...this.globalOptions,
      ...options,
    };
    const requestId = options.requestId || uuidv4();

    const context: RequestContext = {
      requestId,
      endpoint,
      method,
      startTime: Date.now(),
      attempt: 0,
    };

    // Enforce Autotask's 3 concurrent thread limit per endpoint.
    // Strip query string so /v1.0/Tickets?id=1 and /v1.0/Tickets share the same slot pool.
    const endpointBase = endpoint.split('?')[0];
    const queueLen = this.endpointSemaphore.queueLength(endpointBase);
    if (queueLen > 0) {
      this.logger.debug(`Autotask thread limit reached for ${endpointBase}, queuing request (${queueLen} ahead)`);
    }
    await this.endpointSemaphore.acquire(endpointBase);

    // Start performance monitoring if enabled
    let performanceTimer:
      | ((statusCode?: number, error?: string) => void)
      | undefined;
    if (mergedOptions.enablePerformanceMonitoring) {
      performanceTimer = this.performanceMonitor.startTimer(endpoint, method);
    }

    try {
      // Use advanced retry strategy if enabled
      if (mergedOptions.useAdvancedRetry) {
        return await this.executeWithAdvancedRetry(
          requestFn,
          context,
          mergedOptions,
          performanceTimer
        );
      }

      // Fall back to legacy retry logic for backward compatibility
      return await this.executeWithLegacyRetry(
        requestFn,
        context,
        mergedOptions,
        performanceTimer
      );
    } finally {
      this.endpointSemaphore.release(endpointBase);
    }
  }

  /**
   * Execute request with advanced retry strategy and circuit breaker
   */
  private async executeWithAdvancedRetry<T>(
    requestFn: () => Promise<AxiosResponse<T>>,
    context: RequestContext,
    options: any,
    performanceTimer?: (statusCode?: number, error?: string) => void
  ): Promise<AxiosResponse<T>> {
    
    // Create retry strategy with merged options
    const retryOptions = {
      ...options.retryStrategy,
      maxRetries: options.retries,
      initialDelay: options.baseDelay,
      onRetry: (error: Error, attempt: number, delay: number) => {
        const logContext: LogContext = {
          correlationId: context.requestId,
          operation: `${context.method} ${context.endpoint}`,
          request: {
            method: context.method,
            url: context.endpoint,
          },
          retry: {
            attempt,
            maxAttempts: options.retries,
            totalTime: Date.now() - context.startTime
          }
        };

        this.errorLogger.logRetry(
          'Request failed, retrying with advanced strategy',
          error,
          { attempt, maxAttempts: options.retries, nextDelay: delay, totalTime: Date.now() - context.startTime },
          logContext
        );

        // Fallback to winston for backward compatibility
        this.logger.warn('Advanced retry: Request failed, retrying', {
          requestId: context.requestId,
          endpoint: context.endpoint,
          method: context.method,
          attempt,
          delay,
          errorType: error.constructor.name,
          errorMessage: error.message,
        });
      },
      isRetryable: (error: Error, attempt: number) => {
        if (error instanceof AutotaskError) {
          return isRetryableError(error);
        }
        return true; // Assume retryable for unknown errors
      }
    };

    const strategy = new RetryStrategy(retryOptions);

    // Wrap the request execution
    const executeWithLogging = async (): Promise<AxiosResponse<T>> => {
      context.attempt++;
      
      this.logRequest(context, options, context.attempt > 1);
      
      try {
        const response = await requestFn();
        this.logResponse(context, response, options);
        
        // Log successful request with ErrorLogger
        const logContext: LogContext = {
          correlationId: context.requestId,
          operation: `${context.method} ${context.endpoint}`,
          request: {
            method: context.method,
            url: context.endpoint,
          },
          performance: {
            startTime: context.startTime,
            duration: Date.now() - context.startTime
          }
        };

        this.errorLogger.info(
          `Request completed successfully`,
          logContext,
          { 
            statusCode: response.status,
            statusText: response.statusText,
            responseSize: JSON.stringify(response.data).length 
          }
        );
        
        // Record successful performance metrics
        if (performanceTimer) {
          performanceTimer(response.status, undefined);
        }
        
        return response;
      } catch (error) {
        const autotaskError = this.handleError(error, context);
        this.logError(context, autotaskError, options);
        throw autotaskError;
      }
    };

    // Use circuit breaker if enabled
    if (options.enableCircuitBreaker) {
      const circuitBreakerName = options.circuitBreakerName || 
        `${context.endpoint}-${context.method}`.replace(/[^a-zA-Z0-9-]/g, '-');
      
      const circuitBreaker = this.circuitBreakerRegistry.getCircuitBreaker(
        circuitBreakerName,
        options.circuitBreaker
      );

      try {
        const result = await circuitBreaker.execute(executeWithLogging);
        
        if (!result.success) {
          // Record error performance metrics
          if (performanceTimer) {
            performanceTimer(undefined, result.error?.message);
          }
          throw result.error;
        }
        
        return result.data!;
      } catch (error) {
        // Handle circuit breaker specific errors
        if (error instanceof CircuitBreakerError) {
          const logContext: LogContext = {
            correlationId: context.requestId,
            operation: `${context.method} ${context.endpoint}`,
            request: {
              method: context.method,
              url: context.endpoint,
            },
            circuitBreaker: {
              name: circuitBreakerName,
              state: 'open',
              metrics: {} as any // Will be populated by circuit breaker
            }
          };

          this.errorLogger.warn('Circuit breaker is open', error, logContext);

          // Fallback to winston for backward compatibility
          this.logger.warn('Circuit breaker is open', {
            requestId: context.requestId,
            endpoint: context.endpoint,
            method: context.method,
            circuitBreakerName,
          });
          
          if (performanceTimer) {
            performanceTimer(503, 'Circuit breaker open');
          }
        }
        throw error;
      }
    }

    // Execute with retry strategy only (no circuit breaker)
    try {
      const result = await strategy.execute(executeWithLogging);
      
      if (!result.success) {
        // Record error performance metrics
        if (performanceTimer) {
          performanceTimer(undefined, result.error?.message);
        }
        throw result.error;
      }
      
      return result.data!;
    } catch (error) {
      // Record error performance metrics
      if (performanceTimer) {
        const autotaskError = error instanceof AutotaskError ? error : 
          this.handleError(error, context);
        performanceTimer(autotaskError.statusCode, autotaskError.message);
      }
      throw error;
    }
  }

  /**
   * Execute request with legacy retry logic (for backward compatibility)
   */
  private async executeWithLegacyRetry<T>(
    requestFn: () => Promise<AxiosResponse<T>>,
    context: RequestContext,
    options: any,
    performanceTimer?: (statusCode?: number, error?: string) => void
  ): Promise<AxiosResponse<T>> {
    let lastError: AutotaskError | undefined;

    for (let attempt = 1; attempt <= options.retries + 1; attempt++) {
      context.attempt = attempt;

      try {
        this.logRequest(context, options, attempt > 1);

        const response = await requestFn();

        this.logResponse(context, response, options);

        // Record successful performance metrics
        if (performanceTimer) {
          performanceTimer(response.status, undefined);
        }

        // Success - return the response
        return response;
      } catch (error) {
        const autotaskError = this.handleError(error, context);
        lastError = autotaskError;

        this.logError(context, autotaskError, options);

        // Record error performance metrics
        if (performanceTimer && attempt === options.retries + 1) {
          // Only record on final attempt to avoid duplicate metrics
          performanceTimer(autotaskError.statusCode, autotaskError.message);
        }

        // Check if we should retry
        if (
          attempt <= options.retries &&
          isRetryableError(autotaskError)
        ) {
          const delay = getRetryDelay(
            autotaskError,
            attempt,
            options.baseDelay
          );

          const logContext: LogContext = {
            correlationId: context.requestId,
            operation: `${context.method} ${context.endpoint}`,
            request: {
              method: context.method,
              url: context.endpoint,
            },
            retry: {
              attempt,
              maxAttempts: options.retries,
              totalTime: Date.now() - context.startTime
            }
          };

          this.errorLogger.logRetry(
            'Request failed, retrying with legacy strategy',
            autotaskError,
            { attempt, maxAttempts: options.retries, nextDelay: delay, totalTime: Date.now() - context.startTime },
            logContext
          );

          // Fallback to winston for backward compatibility
          this.logger.warn(`Legacy retry: Request failed, retrying in ${delay}ms`, {
            requestId: context.requestId,
            endpoint: context.endpoint,
            method: context.method,
            attempt,
            maxRetries: options.retries,
            delay,
            errorType: autotaskError.constructor.name,
            statusCode: autotaskError.statusCode,
          });

          await this.sleep(delay);
          continue;
        }

        // No more retries or non-retryable error
        throw autotaskError;
      }
    }

    // This should never be reached, but TypeScript requires it
    throw lastError || new Error('Unexpected error in request execution');
  }

  /**
   * Handle and classify errors
   */
  private handleError(error: any, context: RequestContext): AutotaskError {
    const requestDetails = {
      endpoint: context.endpoint,
      method: context.method,
      requestId: context.requestId,
    };

    if (error.isAxiosError) {
      return createAutotaskError(error as AxiosError, requestDetails);
    }

    if (error instanceof AutotaskError) {
      return error;
    }

    // Handle non-axios errors
    return createAutotaskError(
      {
        message: error.message || 'Unknown error',
        isAxiosError: false,
      } as AxiosError,
      requestDetails
    );
  }

  /**
   * Log request details
   */
  private logRequest(
    context: RequestContext,
    options: Required<RequestOptions>,
    isRetry: boolean = false
  ): void {
    if (!options.enableRequestLogging) return;

    const logData = {
      requestId: context.requestId,
      endpoint: context.endpoint,
      method: context.method,
      attempt: context.attempt,
      isRetry,
      timestamp: new Date().toISOString(),
    };

    if (isRetry) {
      this.logger.info('Retrying request', logData);
    } else {
      this.logger.info('Making request', logData);
    }
  }

  /**
   * Log response details
   */
  private logResponse<T>(
    context: RequestContext,
    response: AxiosResponse<T>,
    options: Required<RequestOptions>
  ): void {
    if (!options.enableResponseLogging) return;

    const duration = Date.now() - context.startTime;

    this.logger.info('Request completed successfully', {
      requestId: context.requestId,
      endpoint: context.endpoint,
      method: context.method,
      statusCode: response.status,
      statusText: response.statusText,
      duration,
      attempt: context.attempt,
      responseSize: JSON.stringify(response.data).length,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Log error details
   */
  private logError(
    context: RequestContext,
    error: AutotaskError,
    options: Required<RequestOptions>
  ): void {
    const duration = Date.now() - context.startTime;

    const logContext: LogContext = {
      correlationId: context.requestId,
      operation: `${context.method} ${context.endpoint}`,
      request: {
        method: context.method,
        url: context.endpoint,
      },
      performance: {
        startTime: context.startTime,
        duration
      }
    };

    const extraData = {
      attempt: context.attempt,
      errorType: error.constructor.name,
      statusCode: error.statusCode,
      isRetryable: isRetryableError(error),
    };

    if (error.statusCode && error.statusCode >= 500) {
      this.errorLogger.error('Server error occurred', error, logContext, extraData);
      this.logger.error('Server error occurred', {
        requestId: context.requestId,
        endpoint: context.endpoint,
        method: context.method,
        ...extraData
      });
    } else if (error.statusCode && error.statusCode >= 400) {
      this.errorLogger.warn('Client error occurred', error, logContext, extraData);
      this.logger.warn('Client error occurred', {
        requestId: context.requestId,
        endpoint: context.endpoint,
        method: context.method,
        ...extraData
      });
    } else {
      this.errorLogger.error('Network or unknown error occurred', error, logContext, extraData);
      this.logger.error('Network or unknown error occurred', {
        requestId: context.requestId,
        endpoint: context.endpoint,
        method: context.method,
        ...extraData
      });
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get performance monitor instance
   */
  getPerformanceMonitor(): PerformanceMonitor {
    return this.performanceMonitor;
  }

  /**
   * Get current performance metrics
   */
  getPerformanceMetrics() {
    return this.performanceMonitor.getMetrics();
  }

  /**
   * Get detailed performance report
   */
  getPerformanceReport() {
    return this.performanceMonitor.getDetailedReport();
  }

  /**
   * Reset performance metrics
   */
  resetPerformanceMetrics(): void {
    this.performanceMonitor.reset();
  }

  /**
   * Log performance summary
   */
  logPerformanceSummary(): void {
    this.performanceMonitor.logSummary();
  }

  /**
   * Update global options for all requests
   */
  updateGlobalOptions(options: Partial<RequestOptions>): void {
    Object.assign(this.globalOptions, options);
  }

  /**
   * Get current global options
   */
  getGlobalOptions(): Partial<RequestOptions> {
    return { ...this.globalOptions };
  }

  /**
   * Get circuit breaker metrics for all endpoints
   */
  getCircuitBreakerMetrics() {
    return this.circuitBreakerRegistry.getAllMetrics();
  }

  /**
   * Get circuit breaker metrics for a specific endpoint
   */
  getCircuitBreakerMetricsForEndpoint(endpoint: string, method: string) {
    const circuitBreakerName = `${endpoint}-${method}`.replace(/[^a-zA-Z0-9-]/g, '-');
    const circuitBreaker = this.circuitBreakerRegistry.getCircuitBreaker(circuitBreakerName);
    return circuitBreaker.getMetrics();
  }

  /**
   * Reset circuit breaker for a specific endpoint
   */
  resetCircuitBreakerForEndpoint(endpoint: string, method: string): void {
    const circuitBreakerName = `${endpoint}-${method}`.replace(/[^a-zA-Z0-9-]/g, '-');
    const circuitBreaker = this.circuitBreakerRegistry.getCircuitBreaker(circuitBreakerName);
    circuitBreaker.reset();
  }

  /**
   * Reset all circuit breakers
   */
  resetAllCircuitBreakers(): void {
    this.circuitBreakerRegistry.resetAll();
  }

  /**
   * Update retry strategy configuration
   */
  updateRetryStrategy(options: Partial<RetryOptions>): void {
    this.retryStrategy = new RetryStrategy({
      maxRetries: this.defaultOptions.retries,
      initialDelay: this.defaultOptions.baseDelay,
      backoffMultiplier: 2,
      jitterFactor: 0.1,
      maxDelay: 30000,
      ...options,
    });
  }

  /**
   * Get comprehensive health status including circuit breakers
   */
  getHealthStatus() {
    const circuitBreakerMetrics = this.getCircuitBreakerMetrics();
    const performanceMetrics = this.getPerformanceMetrics();
    
    const healthyCircuitBreakers = Object.values(circuitBreakerMetrics).filter(
      metrics => metrics.state === CircuitBreakerState.CLOSED
    ).length;
    
    const totalCircuitBreakers = Object.keys(circuitBreakerMetrics).length;
    
    return {
      timestamp: new Date().toISOString(),
      status: healthyCircuitBreakers === totalCircuitBreakers ? 'healthy' : 'degraded',
      circuitBreakers: {
        total: totalCircuitBreakers,
        healthy: healthyCircuitBreakers,
        open: Object.values(circuitBreakerMetrics).filter(
          metrics => metrics.state === CircuitBreakerState.OPEN
        ).length,
        halfOpen: Object.values(circuitBreakerMetrics).filter(
          metrics => metrics.state === CircuitBreakerState.HALF_OPEN
        ).length,
        metrics: circuitBreakerMetrics
      },
      performance: performanceMetrics,
      features: {
        advancedRetry: this.defaultOptions.useAdvancedRetry,
        circuitBreaker: this.defaultOptions.enableCircuitBreaker,
        performanceMonitoring: this.defaultOptions.enablePerformanceMonitoring,
      }
    };
  }

  /**
   * Configure endpoint-specific circuit breaker
   */
  configureCircuitBreakerForEndpoint(
    endpoint: string, 
    method: string, 
    options: CircuitBreakerOptions
  ): void {
    const circuitBreakerName = `${endpoint}-${method}`.replace(/[^a-zA-Z0-9-]/g, '-');
    this.circuitBreakerRegistry.getCircuitBreaker(circuitBreakerName, options);
  }
}
