FROM node:20-alpine AS build

WORKDIR /app

COPY package.json yarn.lock ./

RUN node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('package.json','utf8')); if (p.devDependencies) delete p.devDependencies['@emergentbase/visual-edits']; fs.writeFileSync('package.json', JSON.stringify(p,null,2));"

RUN yarn install --frozen-lockfile

COPY . .

ARG REACT_APP_BACKEND_URL
ENV REACT_APP_BACKEND_URL=${REACT_APP_BACKEND_URL}
ENV NODE_ENV=production

RUN yarn build


FROM nginx:1.27-alpine

COPY --from=build /app/build /usr/share/nginx/html

RUN mkdir -p /etc/nginx/templates && printf 'server {\n\
  listen ${PORT};\n\
  server_name _;\n\
  root /usr/share/nginx/html;\n\
  index index.html;\n\
\n\
  location / {\n\
    try_files $uri $uri/ /index.html;\n\
  }\n\
}\n' > /etc/nginx/templates/default.conf.template

CMD ["nginx", "-g", "daemon off;"]
