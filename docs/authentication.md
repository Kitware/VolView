# Authentication & Authorization

VolView itself does not specify any given authentication mechanism to use. How you let VolView access authenticated resources depends on individual deployment needs.

## VolView behind Login Portal

The easiest approach to securing a VolView instance is to host VolView behind an authentication portal. This will secure access to VolView, and allow VolView to automatically use existing user credentials to request protected data. Often the credentials are stored in a cookie.

## OAuth Tokens via URL

When accessing OAuth-protected resources, VolView by default does not add the `Authorization` header to requests. It is possible to tell VolView to add `Authorization` headers to all requests, via the `token` and `tokenUrl` parameters.

### `token` URL parameter

> [!WARNING]
> This is a discouraged approach! Only use it if you absolutely must.

You can pass in the `token` URL parameter like so: `https://example.com/VolView/?token=XXXX`. When VolView sees this, it will extract the token from the URL and use it for all subsequent data requests. VolView will also strip the token from the URL to prevent saving the token into the browser history.

### `tokenUrl` URL parameter

As an alternative to passing in the token via the URL, if you have an endpoint that returns the user's token then you can use the `tokenUrl` parameter like so: `https://example.com/VolView/?tokenUrl=https://example.com/userToken`. If VolView successfully receives a token from this endpoint, it will use the token in subsequent data requests.

The token URL is expected to return the access token as plaintext, i.e. `text/plain`. Please note that you cannot use an OAuth token endpoint here! OAuth token endpoints are used to exchange auth information, while `tokenUrl` must return just the access token under an already-authenticated session.

By default, VolView will make a `GET` request to the token URL. If another type of request is needed, you can configure it via the `tokenUrlMethod` parameter. For example, to make a `POST` request: `https:/example.com/VolView/?tokenUrl=https://example.com/userToken&tokenUrlMethod=POST`.

> [!NOTE]
> This requires CORS to be properly configured for the token URL endpoint. See the [CORS](/cors) documentation for more info.
