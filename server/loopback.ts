/** Only hosts with a loopback bind are eligible for the local web ChatGPT session. */
export function isLoopbackHost(hostname: string | boolean | undefined): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}
