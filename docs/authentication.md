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

#### Common scenario: a hosted client reading protected data on another origin

A data portal links a user to a shared/hosted VolView (e.g. the public
`volview.kitware.app`) and passes a token so VolView can pull that user's
protected images back from the portal's API:

```
https://volview.kitware.app/?names=[study.zip]&urls=[https://data.example.org/api/getImage?id=...]&token=XXXX
```

The bearer rides to `data.example.org` even though it is a different origin from
the client — this cross-origin read is the intended, supported use. For it to
work, the **data server** (not VolView) must set CORS, and two details trip
people up:

- `Access-Control-Allow-Origin` must be a **single** value. A header echoing
  several (`*, volview.kitware.app`) is invalid and the browser rejects it — send
  either `*` or the one VolView origin.
- The preflight must permit the auth header:
  `Access-Control-Allow-Headers: authorization`. Attaching `Authorization`
  forces a preflight, so a server that omits this passes anonymous requests but
  rejects tokened ones.

Saving is **not** part of this scenario — a hosted client cannot save to the
portal's origin (see [Remote save is same-origin only](#remote-save-is-same-origin-only)).

### `tokenUrl` URL parameter

As an alternative to passing in the token via the URL, if you have an endpoint that returns the user's token then you can use the `tokenUrl` parameter like so: `https://example.com/VolView/?tokenUrl=https://example.com/userToken`. If VolView successfully receives a token from this endpoint, it will use the token in subsequent data requests.

The token URL is expected to respond `200 OK` with the access token as plaintext, i.e. `text/plain` — just the token, nothing else. Please note that you cannot use an OAuth token endpoint here! OAuth token endpoints are used to exchange auth information and reply with a JSON object, while `tokenUrl` must return just the access token under an already-authenticated session.

By default, VolView will make a `GET` request to the token URL. If another type of request is needed, you can configure it via the `tokenUrlMethod` parameter. For example, to make a `POST` request: `https:/example.com/VolView/?tokenUrl=https://example.com/userToken&tokenUrlMethod=POST`.

> [!NOTE]
> This requires CORS to be properly configured for the token URL endpoint. See the [CORS](/cors) documentation for more info.

## Remote save is same-origin only

Tokens authorize *reading* data from any origin. They do **not** enable saving to another origin.

The remote save target (`save=`) is accepted only when its origin matches the origin serving VolView. A cross-origin `save=` URL is refused, and the save UI stays disabled — so **a `token=` (or `tokenUrl=`) plus a cross-origin `save=` does not work**, even though the same token will happily authorize cross-origin data requests. To save, host VolView on the same origin as the endpoint that receives the session.

This is deliberate: it means a deployment that serves no save endpoint of its own — such as the public demo — has no save at all, with nothing to configure, and a crafted `?save=https://attacker.example/` link cannot POST the user's session to a third party.

Loading is unaffected: `urls=` accepts any origin, so public cross-origin datasets (IDC S3, TCIA GCS buckets) load normally.
