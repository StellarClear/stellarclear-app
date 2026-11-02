declare module "node:http" {
  export interface IncomingMessage {
    method?: string;
    url?: string;
    headers: Record<string, string | string[] | undefined>;
    on(event: "data", listener: (chunk: any) => void): this;
    on(event: "end", listener: () => void): this;
    on(event: "error", listener: (err: Error) => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
  }

  export interface ServerResponse {
    writeHead(statusCode: number, headers?: Record<string, string | number | readonly string[]>): this;
    end(data?: string | Uint8Array, callback?: () => void): this;
  }

  export interface AddressInfo {
    address: string;
    family: string;
    port: number;
  }

  export interface Server {
    listen(port?: number, hostname?: string, listeningListener?: () => void): this;
    close(callback?: (err?: Error) => void): this;
    address(): AddressInfo | string | null;
    once(event: string, listener: (...args: any[]) => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
  }

  export function createServer(
    requestListener?: (req: IncomingMessage, res: ServerResponse) => void
  ): Server;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}

declare module "node:crypto" {
  export function createHmac(algorithm: string, key: string | Uint8Array): {
    update(data: string | Uint8Array): any;
    digest(encoding?: string): string;
  };
  export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;
}

declare namespace NodeJS {
  interface Timeout {}
}

declare const Buffer: {
  isBuffer(obj: any): boolean;
  from(data: any, encoding?: string): Uint8Array & { toString(encoding?: string): string };
  concat(list: Uint8Array[]): Uint8Array & { toString(encoding?: string): string };
};

type Buffer = Uint8Array & { toString(encoding?: string): string };

declare const process: {
  env: Record<string, string | undefined>;
  argv: string[];
  exit(code?: number): never;
  on(event: string, listener: (...args: any[]) => void): any;
};
