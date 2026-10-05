declare module "node:http" {
  export interface IncomingMessage {
    url?: string;
    headers: Record<string, string | string[] | undefined>;
  }
  export interface ServerResponse {
    writeHead(statusCode: number, headers?: Record<string, string | number>): this;
    end(data?: string): this;
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

declare module "node:crypto" {
  export function createHash(algorithm: string): {
    update(data: string): { digest(encoding: "base64" | "hex"): string };
  };
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}

declare namespace NodeJS {
  interface Timeout {}
}

declare const process: {
  env: Record<string, string | undefined>;
  argv: string[];
  exit(code?: number): never;
  on(event: string, listener: (...args: any[]) => void): any;
};
