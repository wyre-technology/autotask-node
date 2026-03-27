import { AxiosInstance } from 'axios';
import winston from 'winston';
import { MethodMetadata, ApiResponse, RequestHandler } from '../types';
import { BaseEntity } from './base';

export interface IQuoteItems {
  id?: number;
  [key: string]: any;
}

export interface IQuoteItemsQuery {
  filter?: Record<string, any>;
  sort?: string;
  page?: number;
  pageSize?: number;
}

/**
 * QuoteItems entity class for Autotask API
 *
 * Line items within quotes
 * Supported Operations: GET, POST, PATCH, PUT, DELETE
 * Category: financial
 *
 * @see {@link https://www.autotask.net/help/DeveloperHelp/Content/APIs/REST/Entities/QuoteItemsEntity.htm}
 */
export class QuoteItems extends BaseEntity {
  private readonly endpoint = '/QuoteItems';

  constructor(
    axios: AxiosInstance,
    logger: winston.Logger,
    requestHandler?: RequestHandler
  ) {
    super(axios, logger, requestHandler);
  }

  static getMetadata(): MethodMetadata[] {
    return [
      {
        operation: 'createQuoteItems',
        requiredParams: ['quoteId', 'quoteItems'],
        optionalParams: [],
        returnType: 'IQuoteItems',
        endpoint: '/Quotes/{quoteId}/Items',
      },
      {
        operation: 'getQuoteItems',
        requiredParams: ['id'],
        optionalParams: [],
        returnType: 'IQuoteItems',
        endpoint: '/QuoteItems/{id}',
      },
      {
        operation: 'updateQuoteItems',
        requiredParams: ['id', 'quoteItems'],
        optionalParams: [],
        returnType: 'IQuoteItems',
        endpoint: '/QuoteItems/{id}',
      },
      {
        operation: 'deleteQuoteItems',
        requiredParams: ['quoteId', 'id'],
        optionalParams: [],
        returnType: 'void',
        endpoint: '/Quotes/{quoteId}/Items/{id}',
      },
      {
        operation: 'listQuoteItems',
        requiredParams: [],
        optionalParams: ['filter', 'sort', 'page', 'pageSize'],
        returnType: 'IQuoteItems[]',
        endpoint: '/QuoteItems',
      },
    ];
  }

  /**
   * Create a new quote item under a parent quote
   * @param quoteId - The parent quote ID
   * @param quoteItems - The quote item data to create
   * @returns Promise with the created quote item
   */
  async create(
    quoteId: number,
    quoteItems: IQuoteItems
  ): Promise<ApiResponse<IQuoteItems>>;
  /**
   * @deprecated Use create(quoteId, quoteItems) instead. QuoteItems is a child entity of Quotes.
   */
  async create(quoteItems: IQuoteItems): Promise<ApiResponse<IQuoteItems>>;
  async create(
    quoteIdOrItems: number | IQuoteItems,
    quoteItems?: IQuoteItems
  ): Promise<ApiResponse<IQuoteItems>> {
    // Support both signatures: create(quoteId, item) and create(item) for backwards compatibility
    let createEndpoint: string;
    let itemData: IQuoteItems;

    if (typeof quoteIdOrItems === 'number' && quoteItems) {
      // New parent-child URL pattern: POST /Quotes/{quoteId}/Items
      createEndpoint = `/Quotes/${quoteIdOrItems}/Items`;
      itemData = quoteItems;
    } else if (typeof quoteIdOrItems === 'object') {
      // Legacy pattern or when quoteID is in the body - extract quoteID for the URL
      itemData = quoteIdOrItems;
      if (itemData.quoteID) {
        createEndpoint = `/Quotes/${itemData.quoteID}/Items`;
      } else {
        // Fallback to flat endpoint (will likely fail with 404)
        createEndpoint = this.endpoint;
      }
    } else {
      createEndpoint = this.endpoint;
      itemData = quoteIdOrItems as any;
    }

    this.logger.info('Creating quote item', {
      endpoint: createEndpoint,
      quoteItems: itemData,
    });
    const createResult = await this.executeRequest<any>(
      async () => this.axios.post(createEndpoint, itemData),
      createEndpoint,
      'POST'
    );

    // The Autotask API returns {itemId: number} for child entity creates.
    // Fetch the full item to return consistent data.
    const newItemId = createResult.data?.itemId ?? createResult.data?.id;
    if (newItemId) {
      return this.get(newItemId);
    }

    return createResult as ApiResponse<IQuoteItems>;
  }

  /**
   * Get a quoteitems by ID
   * @param id - The quoteitems ID
   * @returns Promise with the quoteitems data
   */
  async get(id: number): Promise<ApiResponse<IQuoteItems>> {
    this.logger.info('Getting quoteitems', { id });
    return this.executeRequest(
      async () => this.axios.get(`${this.endpoint}/${id}`),
      this.endpoint,
      'GET'
    );
  }

  /**
   * Update a quoteitems
   * @param id - The quoteitems ID
   * @param quoteItems - The updated quoteitems data
   * @returns Promise with the updated quoteitems
   */
  async update(
    id: number,
    quoteItems: Partial<IQuoteItems>
  ): Promise<ApiResponse<IQuoteItems>> {
    this.logger.info('Updating quoteitems', { id, quoteItems });
    return this.executeRequest(
      async () => this.axios.put(this.endpoint, quoteItems),
      this.endpoint,
      'PUT'
    );
  }

  /**
   * Partially update a quoteitems
   * @param id - The quoteitems ID
   * @param quoteItems - The partial quoteitems data to update
   * @returns Promise with the updated quoteitems
   */
  async patch(
    id: number,
    quoteItems: Partial<IQuoteItems>
  ): Promise<ApiResponse<IQuoteItems>> {
    this.logger.info('Patching quoteitems', { id, quoteItems });
    return this.executeRequest(
      async () =>
        this.axios.patch(this.endpoint, { ...(quoteItems as any), id }),
      this.endpoint,
      'PATCH'
    );
  }

  /**
   * Delete a quote item
   * @param quoteId - The parent quote ID
   * @param id - The quote item ID
   */
  async delete(quoteId: number, id: number): Promise<void>;
  /**
   * @deprecated Use delete(quoteId, id) instead. QuoteItems require parent-child URL for deletion.
   */
  async delete(id: number): Promise<void>;
  async delete(quoteIdOrItemId: number, itemId?: number): Promise<void> {
    let deleteEndpoint: string;
    if (itemId !== undefined) {
      deleteEndpoint = `/Quotes/${quoteIdOrItemId}/Items/${itemId}`;
    } else {
      // Legacy fallback - try flat endpoint (may return 405)
      deleteEndpoint = `${this.endpoint}/${quoteIdOrItemId}`;
    }
    this.logger.info('Deleting quote item', { endpoint: deleteEndpoint });
    await this.executeRequest(
      async () => this.axios.delete(deleteEndpoint),
      deleteEndpoint,
      'DELETE'
    );
  }

  /**
   * List quoteitems with optional filtering
   * @param query - Query parameters for filtering, sorting, and pagination
   * @returns Promise with array of quoteitems
   */
  async list(
    query: IQuoteItemsQuery = {}
  ): Promise<ApiResponse<IQuoteItems[]>> {
    this.logger.info('Listing quoteitems', { query });
    const searchBody: Record<string, any> = {};

    // Set up basic filter if none provided
    if (!query.filter || Object.keys(query.filter).length === 0) {
      searchBody.filter = [
        {
          op: 'gte',
          field: 'id',
          value: 0,
        },
      ];
    } else {
      // Convert object filter to array format
      if (!Array.isArray(query.filter)) {
        const filterArray = [];
        for (const [field, value] of Object.entries(query.filter)) {
          // Handle nested objects like { id: { gte: 0 } }
          if (
            typeof value === 'object' &&
            value !== null &&
            !Array.isArray(value)
          ) {
            // Extract operator and value from nested object
            const [op, val] = Object.entries(value)[0] as [string, any];
            filterArray.push({
              op: op,
              field: field,
              value: val,
            });
          } else {
            filterArray.push({
              op: 'eq',
              field: field,
              value: value,
            });
          }
        }
        searchBody.filter = filterArray;
      } else {
        searchBody.filter = query.filter;
      }
    }

    if (query.sort) searchBody.sort = query.sort;
    if (query.page) searchBody.page = query.page;
    if (query.pageSize) searchBody.maxRecords = query.pageSize;

    return this.executeQueryRequest(
      async () => this.axios.post(`${this.endpoint}/query`, searchBody),
      `${this.endpoint}/query`,
      'POST'
    );
  }
}
