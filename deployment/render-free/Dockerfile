FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY . .
RUN dotnet restore src/Swarm.Api/Swarm.Api.csproj \
    && dotnet restore src/Swarm.GameServer/Swarm.GameServer.csproj
RUN dotnet publish src/Swarm.Api/Swarm.Api.csproj -c Release -o /out/api --no-restore \
    && dotnet publish src/Swarm.GameServer/Swarm.GameServer.csproj -c Release -o /out/game --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:8.0-alpine AS runtime
RUN apk add --no-cache nginx
WORKDIR /app
COPY --from=build /out/api ./api
COPY --from=build /out/game ./game
COPY deployment/render-free/nginx.conf /etc/nginx/http.d/default.conf
COPY deployment/render-free/start.sh ./start.sh
RUN chmod +x ./start.sh
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["/app/start.sh"]
