# Cross Origin Resource Sharing (CORS)

CORS is a browser mechanism to let servers protect user data from malicious user-side scripts. In a nutshell, CORS protections prevent browsers from allowing JavaScript to read the responses of cross-origin requests unless certain conditions are met.

For VolView, this manifests most prominently when fetching remote datasets. If the public VolView instance at <https://volview.kitware.app> requests MRI data from <https://example.com/mri-data.nrrd>, the request may fail if `example.com` has not whitelisted `volview.kitware.app`.

The rest of this document describes two ways to resolve this issue.

## Whitelist your VolView domain on the data server

If you have control over the data server, you can whitelist your VolView domain. The simpliest way to do this is to set the `Access-Control-Allow-Origin: MYDOMAIN` header on the server. How this is done depends on the static file server that you are using. An example is provided below.

### Nginx example

Please see [the deployment docs](/deploying_volview) for more info on what an expanded nginx configuration may look like.

```
server {
    ...

    # Replace "volview.kitware.app" with the domain on which
    # VolView is being hosted.
    add_header Access-Control-Allow-Origin "volview.kitware.app"
}
```

## CORS proxy

If you do not control the data server, you can use a CORS proxy. A CORS proxy is a lightweight proxy server that is configured to attach CORS headers to responses originating from the data server.