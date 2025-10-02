# Deploying VolView

Deploying VolView is straightforward: just take the locally built files in `dist/` and put them on any static site hosting.

As a local example, running `npx serve dist/` will spin up a static file server (running on <http://localhost:3000>) that reads the locally built files from `dist/`.

> [!NOTE]
> Using `npx serve` is _not_ a recommended way to deploy VolView. It is only used to demonstrate how easy it can be to deploy VolView in simple scenarios.

## Managed Hosting (S3, GCP, etc.)

Please refer to your hosting provider's documentation on how to host a static site. You will need to upload the built files in `dist/` to wherever your provider specifies.

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
