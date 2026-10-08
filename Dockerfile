# Static hosting with nginx.
#   docker build -t nitido .
#   docker run -p 8080:80 nitido      → http://localhost:8080
# Run `npm run models` first if you want the AI models bundled in the image.
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY . /tmp/app
RUN cp -r /tmp/app/index.html /tmp/app/sw.js /tmp/app/manifest.webmanifest /tmp/app/icon.svg /tmp/app/styles /tmp/app/src /usr/share/nginx/html/ \
 && (cp -r /tmp/app/models /usr/share/nginx/html/ 2>/dev/null || true) \
 && rm -rf /tmp/app
