import { ApolloClient, InMemoryCache } from "@apollo/client";
import { BatchHttpLink } from "@apollo/client/link/batch-http";
import { GRAPHQL_ENDPOINT } from "../config/endpoint";
import { taroFetch } from "./taro-fetch";

export const client = new ApolloClient({
    cache: new InMemoryCache(),
    queryDeduplication: false,
    defaultOptions: {
        query: { fetchPolicy: "no-cache" },
        watchQuery: { fetchPolicy: "no-cache" },
    },
    link: new BatchHttpLink({
        uri: GRAPHQL_ENDPOINT,
        fetch: taroFetch,
        batchInterval: 10,
        batchMax: 10,
    }),
});
