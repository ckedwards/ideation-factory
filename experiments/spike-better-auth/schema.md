# Better Auth schema (generated)

From `bun src/gen-schema.ts`: Better Auth 1.7.14 with this spike's plugins, on SQLite.

## account

| column | type | not null | key |
|---|---|---|---|
| id | TEXT | yes | primary |
| accountId | TEXT | yes |  |
| providerId | TEXT | yes |  |
| userId | TEXT | yes | → user.id (CASCADE) |
| accessToken | TEXT |  |  |
| refreshToken | TEXT |  |  |
| idToken | TEXT |  |  |
| accessTokenExpiresAt | date |  |  |
| refreshTokenExpiresAt | date |  |  |
| scope | TEXT |  |  |
| password | TEXT |  |  |
| createdAt | date | yes |  |
| updatedAt | date | yes |  |
- index (userId)
- unique (id) [pk]

## apikey

| column | type | not null | key |
|---|---|---|---|
| id | TEXT | yes | primary |
| configId | TEXT | yes |  |
| name | TEXT |  |  |
| start | TEXT |  |  |
| referenceId | TEXT | yes |  |
| prefix | TEXT |  |  |
| key | TEXT | yes |  |
| refillInterval | INTEGER |  |  |
| refillAmount | INTEGER |  |  |
| lastRefillAt | date |  |  |
| enabled | INTEGER |  |  |
| rateLimitEnabled | INTEGER |  |  |
| rateLimitTimeWindow | INTEGER |  |  |
| rateLimitMax | INTEGER |  |  |
| requestCount | INTEGER |  |  |
| remaining | INTEGER |  |  |
| lastRequest | date |  |  |
| expiresAt | date |  |  |
| createdAt | date | yes |  |
| updatedAt | date | yes |  |
| permissions | TEXT |  |  |
| metadata | TEXT |  |  |
- index (key)
- index (referenceId)
- index (configId)
- unique (id) [pk]

## deviceCode

| column | type | not null | key |
|---|---|---|---|
| id | TEXT | yes | primary |
| deviceCode | TEXT | yes |  |
| userCode | TEXT | yes |  |
| userId | TEXT |  |  |
| expiresAt | date | yes |  |
| status | TEXT | yes |  |
| lastPolledAt | date |  |  |
| pollingInterval | INTEGER |  |  |
| clientId | TEXT |  |  |
| scope | TEXT |  |  |
| resources | TEXT |  |  |
| oauthClientId | TEXT |  |  |
- unique (userCode)
- unique (deviceCode)
- unique (id) [pk]

## jwks

| column | type | not null | key |
|---|---|---|---|
| id | TEXT | yes | primary |
| publicKey | TEXT | yes |  |
| privateKey | TEXT | yes |  |
| createdAt | date | yes |  |
| expiresAt | date |  |  |
| alg | TEXT |  |  |
| crv | TEXT |  |  |
- unique (id) [pk]

## oauthAccessToken

| column | type | not null | key |
|---|---|---|---|
| id | TEXT | yes | primary |
| token | TEXT | yes |  |
| clientId | TEXT | yes | → oauthClient.clientId (CASCADE) |
| sessionId | TEXT |  | → session.id (SET NULL) |
| userId | TEXT |  | → user.id (CASCADE) |
| referenceId | TEXT |  |  |
| authorizationCodeId | TEXT |  |  |
| resources | TEXT |  |  |
| requestedUserInfoClaims | TEXT |  |  |
| refreshId | TEXT |  | → oauthRefreshToken.id (CASCADE) |
| expiresAt | date | yes |  |
| createdAt | date | yes |  |
| revoked | date |  |  |
| confirmation | TEXT |  |  |
| scopes | TEXT | yes |  |
- index (refreshId)
- index (authorizationCodeId)
- index (userId)
- index (sessionId)
- index (clientId)
- unique (token)
- unique (id) [pk]

## oauthClient

| column | type | not null | key |
|---|---|---|---|
| id | TEXT | yes | primary |
| clientId | TEXT | yes |  |
| clientSecret | TEXT |  |  |
| clientDiscoveryId | TEXT |  |  |
| disabled | INTEGER |  |  |
| skipConsent | INTEGER |  |  |
| enableEndSession | INTEGER |  |  |
| subjectType | TEXT |  |  |
| scopes | TEXT |  |  |
| clientCredentialsScopes | TEXT |  |  |
| userId | TEXT |  | → user.id (CASCADE) |
| createdAt | date |  |  |
| updatedAt | date |  |  |
| name | TEXT |  |  |
| uri | TEXT |  |  |
| icon | TEXT |  |  |
| contacts | TEXT |  |  |
| tos | TEXT |  |  |
| policy | TEXT |  |  |
| softwareId | TEXT |  |  |
| softwareVersion | TEXT |  |  |
| softwareStatement | TEXT |  |  |
| redirectUris | TEXT | yes |  |
| postLogoutRedirectUris | TEXT |  |  |
| backchannelLogoutUri | TEXT |  |  |
| backchannelLogoutSessionRequired | INTEGER |  |  |
| tokenEndpointAuthMethod | TEXT |  |  |
| applicationType | TEXT |  |  |
| jwks | TEXT |  |  |
| jwksUri | TEXT |  |  |
| grantTypes | TEXT |  |  |
| responseTypes | TEXT |  |  |
| requirePKCE | INTEGER |  |  |
| dpopBoundAccessTokens | INTEGER |  |  |
| referenceId | TEXT |  |  |
| metadata | TEXT |  |  |
- index (userId)
- unique (clientId)
- unique (id) [pk]

## oauthClientAssertion

| column | type | not null | key |
|---|---|---|---|
| id | TEXT | yes | primary |
| expiresAt | date | yes |  |
- unique (id) [pk]

## oauthClientResource

| column | type | not null | key |
|---|---|---|---|
| id | TEXT | yes | primary |
| clientId | TEXT | yes | → oauthClient.clientId (CASCADE) |
| resourceId | TEXT | yes | → oauthResource.identifier (CASCADE) |
| metadata | TEXT |  |  |
| createdAt | date |  |  |
- unique (clientId, resourceId)
- index (resourceId)
- index (clientId)
- unique (id) [pk]

## oauthConsent

| column | type | not null | key |
|---|---|---|---|
| id | TEXT | yes | primary |
| clientId | TEXT | yes | → oauthClient.clientId (CASCADE) |
| userId | TEXT |  | → user.id (CASCADE) |
| referenceId | TEXT |  |  |
| resources | TEXT |  |  |
| requestedUserInfoClaims | TEXT |  |  |
| scopes | TEXT | yes |  |
| createdAt | date | yes |  |
| updatedAt | date | yes |  |
- index (userId)
- index (clientId)
- unique (id) [pk]

## oauthRefreshToken

| column | type | not null | key |
|---|---|---|---|
| id | TEXT | yes | primary |
| token | TEXT | yes |  |
| clientId | TEXT | yes | → oauthClient.clientId (CASCADE) |
| sessionId | TEXT |  | → session.id (SET NULL) |
| userId | TEXT | yes | → user.id (CASCADE) |
| referenceId | TEXT |  |  |
| authorizationCodeId | TEXT |  |  |
| resources | TEXT |  |  |
| requestedUserInfoClaims | TEXT |  |  |
| expiresAt | date | yes |  |
| createdAt | date | yes |  |
| revoked | date |  |  |
| rotatedAt | date |  |  |
| rotationReplayResponse | TEXT |  |  |
| rotationReplayExpiresAt | date |  |  |
| authTime | date |  |  |
| confirmation | TEXT |  |  |
| scopes | TEXT | yes |  |
- index (authorizationCodeId)
- index (userId)
- index (sessionId)
- index (clientId)
- unique (token)
- unique (id) [pk]

## oauthResource

| column | type | not null | key |
|---|---|---|---|
| id | TEXT | yes | primary |
| identifier | TEXT | yes |  |
| name | TEXT | yes |  |
| accessTokenTtl | INTEGER |  |  |
| refreshTokenTtl | INTEGER |  |  |
| signingAlgorithm | TEXT |  |  |
| signingKeyId | TEXT |  |  |
| allowedScopes | TEXT |  |  |
| customClaims | TEXT |  |  |
| dpopBoundAccessTokensRequired | INTEGER |  |  |
| disabled | INTEGER |  |  |
| createdAt | date |  |  |
| updatedAt | date |  |  |
| policyVersion | INTEGER |  |  |
| metadata | TEXT |  |  |
- unique (identifier)
- unique (id) [pk]

## passkey

| column | type | not null | key |
|---|---|---|---|
| id | TEXT | yes | primary |
| name | TEXT |  |  |
| publicKey | TEXT | yes |  |
| userId | TEXT | yes | → user.id (CASCADE) |
| credentialID | TEXT | yes |  |
| counter | INTEGER | yes |  |
| deviceType | TEXT | yes |  |
| backedUp | INTEGER | yes |  |
| transports | TEXT |  |  |
| createdAt | date |  |  |
| aaguid | TEXT |  |  |
- index (credentialID)
- index (userId)
- unique (id) [pk]

## session

| column | type | not null | key |
|---|---|---|---|
| id | TEXT | yes | primary |
| expiresAt | date | yes |  |
| token | TEXT | yes |  |
| createdAt | date | yes |  |
| updatedAt | date | yes |  |
| ipAddress | TEXT |  |  |
| userAgent | TEXT |  |  |
| userId | TEXT | yes | → user.id (CASCADE) |
| signInMethod | TEXT |  |  |
| oauthPurpose | TEXT |  |  |
- index (userId)
- unique (token)
- unique (id) [pk]

## user

| column | type | not null | key |
|---|---|---|---|
| id | TEXT | yes | primary |
| name | TEXT | yes |  |
| email | TEXT | yes |  |
| emailVerified | INTEGER | yes |  |
| image | TEXT |  |  |
| createdAt | date | yes |  |
| updatedAt | date | yes |  |
| username | TEXT |  |  |
| displayUsername | TEXT |  |  |
| inactive | INTEGER |  |  |
- unique (username)
- unique (email)
- unique (id) [pk]

## verification

| column | type | not null | key |
|---|---|---|---|
| id | TEXT | yes | primary |
| identifier | TEXT | yes |  |
| value | TEXT | yes |  |
| expiresAt | date | yes |  |
| createdAt | date | yes |  |
| updatedAt | date | yes |  |
- index (identifier)
- unique (id) [pk]
