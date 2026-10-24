# Deploying VolView

Deploying VolView is straightforward: just take the locally built files in `dist/` and put them on any static site hosting.

As a local example, running `npx serve dist/` will spin up a static file server (running on <http://localhost:3000>) that reads the locally built files from `dist/`.

> [!NOTE]
> Using `npx serve` is _not_ a recommended way to deploy VolView. It is only used to demonstrate how easy it can be to deploy VolView in simple scenarios.

## Managed Hosting (S3, GCP, etc.)

Please refer to your hosting provider's documentation on how to host a static site. You will need to upload the built files in `dist/` to wherever your provider specifies.

### Netlify visit analytics

The `visits` Edge Function records GET requests to `/` using GoatCounter's
[backend API](https://www.goatcounter.com/help/backend). To enable it:

1. In GoatCounter, open your username menu, then **API**, and create a token
   with permission to count pageviews.
2. In Netlify, open **Project configuration > Environment variables** and set
   `GOATCOUNTER_SITE` to your GoatCounter site URL (for example,
   `https://volview.goatcounter.com`) and `GOATCOUNTER_API_TOKEN` to that token.
   Both variables need the **Functions** scope. Set values only in the deploy
   contexts you intend to track; leave previews and local development unset.
   The token must remain server-side and must not have a `VITE_` prefix.
3. Redeploy. Edge Functions pick up environment variable changes on deployment.
   Ensure Netlify Split Testing is disabled, since it prevents Edge Functions
   from running.

Deployments that already have `GOATCOUNTER_SITE` also need the API token. Without
it, the function skips tracking and logs a configuration warning. Without a site
URL, analytics stays disabled silently.

The function uses `context.waitUntil()` to finish tracking after serving the page,
with a 10-second request timeout. Under **Cloud compute > Edge functions**, select
`visits` to see accepted or filtered pageviews, HTTP rejection statuses, and
network failures. Logs exclude tokens, visitor IP addresses, request URLs, and
response bodies. The function sends the host and path, referrer origin and path,
user agent, and visitor IP needed by GoatCounter for sessions and location;
query strings and fragments are omitted.

## Self-hosted Server (nginx, apache2, etc.)

Please refer to your desired server's documentation on how to serve static files. You will need to upload the built files in `dist/` to the static file directory on your server. Several examples are provided below.

### Apache example config

In this apache2 example, the `dist/*` files are located under `/var/www/VolView`, and the domain is `example.com`. This does _not_ configure TLS.

```
<VirtualHost *:80>
   ServerName YOUR_SERVER_NAME
   DocumentRoot "/var/www/VolView"
</VirtualHost>
```

### Nginx example config

In this nginx example, the `dist/*` files are located under `/var/www/VolView`, and the domain is `example.com`. This does _not_ configure TLS.

```
server {
	listen 80;
	listen [::]:80;

	server_name example.com;
	root /var/www/VolView;

	# index.html fallback
	location / {
		try_files $uri $uri/ /index.html;
	}
}
```
