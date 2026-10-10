/**
 * Host half of the DeepSeek peak / off-peak indicator bundle.
 *
 * The bundle contributes browser presentation only, so the host body is empty:
 * it exists so the Loader has a host-side row for this package, which is what
 * makes the client module system pick up the package's `dsh.client`
 * declaration and serve `./client` to the page.
 */
export function apply() {}
