import React, {
  ReactNode,
  createContext,
  useEffect,
  useState,
  useRef,
} from "react";
import { Typography } from "@mui/material";
import axios, { AxiosInstance } from "axios";
import {
  ApolloClient,
  InMemoryCache,
  ApolloProvider,
  HttpLink,
  split,
} from "@apollo/client";
import { getMainDefinition } from "@apollo/client/utilities";

import { createClient } from "graphql-ws";
import { ApolloLink, Operation, FetchResult, Observable } from "@apollo/client";

class WebSocketLink extends ApolloLink {
  private client: any;

  constructor(url: string) {
    super();
    this.client = createClient({ url });
  }

  public request(operation: Operation): Observable<FetchResult> {
    return new Observable((sink) => {
      return this.client.subscribe(
        { ...operation, query: operation.query.loc?.source.body },
        {
          next: sink.next.bind(sink),
          error: sink.error.bind(sink),
          complete: sink.complete.bind(sink),
        }
      );
    });
  }
}

interface MainserverProviderProps {
  children: ReactNode;
  tryInterval?: number;
  env?: "tst" | "dev";
}

const DEFAULT_TRY_INTERVAL = 3000;

const IDLE = "IDLE";
const CHECKING_MESSAGE = "Checking server availability...";
const BAD_MESSAGE = "Server is not available. Please try again later.";
const GOOD_STATUS = "good";

const checkServerAvailability = async (axiosInstance: AxiosInstance) => {
  try {
    return (await axiosInstance.get("areyoualive")).data.answer === "yes"
      ? GOOD_STATUS
      : BAD_MESSAGE;
  } catch (err) {
    return BAD_MESSAGE;
  }
};

interface MainserverContextProps {
  axiosInstance: AxiosInstance;
  version: string;
}

export const MainserverContext = createContext<MainserverContextProps | null>(
  null
);

export const MainserverProvider = ({
  children,
  tryInterval,
  env,
}: MainserverProviderProps) => {
  const [status, setStatus] = useState<string>(IDLE);
  const [version, setVersion] = useState<string>();

  const statusRef = useRef(status);

  const baseURL =
    process.env.NODE_ENV === "development"
      ? "http://localhost:6555/"
      : `https://${env || ""}mainserver.failean.com/`;

  const axiosInstance = axios.create({
    baseURL,
    withCredentials: true,
    headers: {
      "Content-Type": "application/json",
    },
  });

  const httpLink = new HttpLink({
    uri: baseURL + "graphql",
  });

  const wsLink = new WebSocketLink(
    process.env.NODE_ENV === "development"
      ? "ws://localhost:6555/graphql"
      : `wss://${env || ""}mainserver.failean.com/graphql`
  );

  const link = split(
    ({ query }) => {
      const definition = getMainDefinition(query);
      return (
        definition.kind === "OperationDefinition" &&
        definition.operation === "subscription"
      );
    },
    wsLink,
    httpLink
  );

  const client = new ApolloClient({
    link,
    cache: new InMemoryCache(),
  });

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    const setStatusAsyncly = async () => {
      setStatus(CHECKING_MESSAGE);
      const newStatus = await checkServerAvailability(axiosInstance);
      const { data } = await axiosInstance.get("areyoualive");
      setStatus(newStatus);
      setVersion(data.version);
      if (newStatus !== GOOD_STATUS) {
        setTimeout(setStatusAsyncly, tryInterval || DEFAULT_TRY_INTERVAL);
      }
    };
    if (statusRef.current === IDLE) {
      setStatusAsyncly();
    }
  }, [axiosInstance, tryInterval]);

  if (status === GOOD_STATUS) {
    return (
      <MainserverContext.Provider
        value={{ version: version || "", axiosInstance }}
      >
        <ApolloProvider client={client}>{children}</ApolloProvider>
      </MainserverContext.Provider>
    );
  } else {
    return <Typography>{status}</Typography>;
  }
};
