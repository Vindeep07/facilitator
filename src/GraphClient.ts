import ApolloClient from 'apollo-client';
import { WebSocketLink } from 'apollo-link-ws';
import { createHttpLink } from 'apollo-link-http';
import { InMemoryCache, NormalizedCacheObject } from 'apollo-cache-inmemory';
import { SubscriptionClient } from 'subscriptions-transport-ws';
import { Subscription } from 'apollo-client/util/Observable';
import gql from 'graphql-tag';
import * as WebSocket from 'ws';

import BigNumber from 'bignumber.js';
import Logger from './Logger';
import TransactionHandler from './TransactionHandler';
import TransactionFetcher from './TransactionFetcher';
import ContractEntityRepository from './repositories/ContractEntityRepository';
import ContractEntity from './models/ContractEntity';

/**
 * The class interacts with graph node server for subscription and query.
 */
export default class GraphClient {
  private apolloClient: ApolloClient<NormalizedCacheObject>;

  /**
   * GraphClient constructor. It expects apollo client as input. Apollo Client is a fully-featured,
   * production ready caching GraphQL client for every UI framework and GraphQL server.
   *
   * @param {ApolloClient<NormalizedCacheObject>} apolloClient Apollo client for subscription.
   */
  public constructor(
    apolloClient: ApolloClient<NormalizedCacheObject>,
  ) {
    this.apolloClient = apolloClient;
  }

  /**
   * Subscribes to the input subscription subgraph query and delegates the response
   * to observer i.e. TransactionHandler.
   * Documentation: https://www.apollographql.com/docs/react/advanced/subscriptions/
   *
   * @param subscriptionQry Subscription query.
   * @param handler Transaction handler object.
   * @param fetcher Transaction fetcher object.
   * @param contractEntityRepository Instance of contract entity repository.
   * @return Query subscription object.
   */
  public async subscribe(
    subscriptionQry: string,
    handler: TransactionHandler,
    fetcher: TransactionFetcher,
    contractEntityRepository: ContractEntityRepository,
  ): Promise<Subscription> {
    if (!subscriptionQry) {
      const err = new TypeError("Mandatory Parameter 'subscriptionQry' is missing or invalid.");
      throw (err);
    }
    // GraphQL query that is parsed into the standard GraphQL AST(Abstract syntax tree)
    const gqlSubscriptionQry = gql`${subscriptionQry}`;
    // Subscription handling
    const observable = this.apolloClient.subscribe({
      query: gqlSubscriptionQry,
      variables: {},
    });
    const querySubscriber = await Promise.resolve(
      observable
        .subscribe({
          async next(response: Record<string, any>) {
            const transactions: Record<
            string,
            Record<string, any>[]
            > = await fetcher.fetch(response.data);
            await handler.handle(transactions);
            await GraphClient.updateLatestUTS(
              transactions,
              response.data,
              contractEntityRepository,
            );
          },
          error(err) {
            Logger.error(err);
          },
        }),
    );

    return querySubscriber;
  }

  /**
   * This method updates latest timestamp for contract entities.
   * @param transactions Transactions for transaction fetcher.
   * @param subscriptionResponse Subscription response.
   * @param contractEntityRepository Instance of contract entity repository.
   */
  private static async updateLatestUTS(
    transactions: Record<string, Record<string, any>[]>,
    subscriptionResponse: Record<string, any[]>,
    contractEntityRepository: ContractEntityRepository,
  ): Promise<void> {
    const savePromises = Object.keys(transactions).map(
      async (transactionKind) => {
        const { contractAddress } = subscriptionResponse[transactionKind][0];
        const transaction = transactions[transactionKind].length > 0
          ? transactions[transactionKind][transactions[transactionKind].length - 1]
          : null;

        // Do nothing if there is no transaction for a transaction kind.
        if (transaction === null) {
          return Promise.resolve();
        }
        const currentUTS = new BigNumber(transaction.uts);

        const contractEntity = new ContractEntity(
          contractAddress,
          transactionKind,
          currentUTS,
        );
        return contractEntityRepository.save(
          contractEntity,
        );
      },
    );

    await Promise.all(savePromises);
  }

  /**
   * Query the graph node.
   *
   * @param query Graph query.
   * @return Response from graph node.
   */
  public async query(query: string, variables: Record<string, any>):
  Promise<{data: Record<string, object[]>}> {
    const gqlQuery = gql`${query}`;
    const queryResult = await this.apolloClient.query({
      query: gqlQuery,
      variables,
    });

    return queryResult;
  }

  /**
   * Creates and returns graph client.
   *
   * @param linkType LinkType ws/http.
   * @param subgraphEndPoint Subgraph endpoint.
   * @return Graph client object.
   */
  public static getClient(linkType: string, subgraphEndPoint: string): GraphClient {
    let link;
    if (linkType === 'ws') {
      // Creates subscription client
      const subscriptionClient = new SubscriptionClient(subgraphEndPoint, {
        reconnect: true,
      },
      WebSocket);

      GraphClient.attachSubscriptionClientCallbacks(subscriptionClient);
      // Creates WebSocket link.
      link = new WebSocketLink(subscriptionClient);
    } else {
      // Creates http link
      link = createHttpLink({ uri: subgraphEndPoint });
    }
    // Instantiate in memory cache object.
    const cache = new InMemoryCache();
    // Instantiate apollo client
    const apolloClient = new ApolloClient({ link, cache });
    // Creates and returns graph client
    return new GraphClient(apolloClient);
  }

  /**
   * This method adds callback to subscription client. Currently, it logs the
   * different callbacks. In future these callbacks, can be useful to design error
   * handling and retry mechanisms.
   *
   * @param subscriptionClient Instance of subscription client.
   */
  private static attachSubscriptionClientCallbacks(subscriptionClient: SubscriptionClient) {
    subscriptionClient.onConnected(() => {
      Logger.info('Connected to the graph node');
    });
    subscriptionClient.onReconnected(() => {
      Logger.info('Reconnected to the graph node');
    });
    subscriptionClient.onConnecting(() => {
      Logger.info('Connecting to the graph node');
    });
    subscriptionClient.onReconnecting(() => {
      Logger.info('Reconnecting to the graph node');
    });
    subscriptionClient.onDisconnected(() => {
      Logger.info('Disconnected to the graph node');
    });
    subscriptionClient.onError((error) => {
      Logger.error(`Error connecting to graph node. Reason: ${error.message}`);
    });
  }
}
