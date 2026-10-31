create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null, "username" text unique, "displayUsername" text, "inactive" integer, "handleConfirmed" integer);

create table "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade, "signInMethod" text, "oauthPurpose" text);

create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);

create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);

create table "jwks" ("id" text not null primary key, "publicKey" text not null, "privateKey" text not null, "createdAt" date not null, "expiresAt" date, "alg" text, "crv" text);

create table "passkey" ("id" text not null primary key, "name" text, "publicKey" text not null, "userId" text not null references "user" ("id") on delete cascade, "credentialID" text not null, "counter" integer not null, "deviceType" text not null, "backedUp" integer not null, "transports" text, "createdAt" date, "aaguid" text);

create table "apikey" ("id" text not null primary key, "configId" text not null, "name" text, "start" text, "referenceId" text not null, "prefix" text, "key" text not null, "refillInterval" integer, "refillAmount" integer, "lastRefillAt" date, "enabled" integer, "rateLimitEnabled" integer, "rateLimitTimeWindow" integer, "rateLimitMax" integer, "requestCount" integer, "remaining" integer, "lastRequest" date, "expiresAt" date, "createdAt" date not null, "updatedAt" date not null, "permissions" text, "metadata" text);

create table "oauthClient" ("id" text not null primary key, "clientId" text not null unique, "clientSecret" text, "clientDiscoveryId" text, "disabled" integer, "skipConsent" integer, "enableEndSession" integer, "subjectType" text, "scopes" text, "clientCredentialsScopes" text, "userId" text references "user" ("id") on delete cascade, "createdAt" date, "updatedAt" date, "name" text, "uri" text, "icon" text, "contacts" text, "tos" text, "policy" text, "softwareId" text, "softwareVersion" text, "softwareStatement" text, "redirectUris" text not null, "postLogoutRedirectUris" text, "backchannelLogoutUri" text, "backchannelLogoutSessionRequired" integer, "tokenEndpointAuthMethod" text, "applicationType" text, "jwks" text, "jwksUri" text, "grantTypes" text, "responseTypes" text, "requirePKCE" integer, "dpopBoundAccessTokens" integer, "referenceId" text, "metadata" text);

create table "oauthResource" ("id" text not null primary key, "identifier" text not null unique, "name" text not null, "accessTokenTtl" integer, "refreshTokenTtl" integer, "signingAlgorithm" text, "signingKeyId" text, "allowedScopes" text, "customClaims" text, "dpopBoundAccessTokensRequired" integer, "disabled" integer, "createdAt" date, "updatedAt" date, "policyVersion" integer, "metadata" text);

create table "oauthClientResource" ("id" text not null primary key, "clientId" text not null references "oauthClient" ("clientId") on delete cascade, "resourceId" text not null references "oauthResource" ("identifier") on delete cascade, "metadata" text, "createdAt" date);

create table "oauthRefreshToken" ("id" text not null primary key, "token" text not null unique, "clientId" text not null references "oauthClient" ("clientId") on delete cascade, "sessionId" text references "session" ("id") on delete set null, "userId" text not null references "user" ("id") on delete cascade, "referenceId" text, "authorizationCodeId" text, "resources" text, "requestedUserInfoClaims" text, "expiresAt" date not null, "createdAt" date not null, "revoked" date, "rotatedAt" date, "rotationReplayResponse" text, "rotationReplayExpiresAt" date, "authTime" date, "confirmation" text, "scopes" text not null);

create table "oauthAccessToken" ("id" text not null primary key, "token" text not null unique, "clientId" text not null references "oauthClient" ("clientId") on delete cascade, "sessionId" text references "session" ("id") on delete set null, "userId" text references "user" ("id") on delete cascade, "referenceId" text, "authorizationCodeId" text, "resources" text, "requestedUserInfoClaims" text, "refreshId" text references "oauthRefreshToken" ("id") on delete cascade, "expiresAt" date not null, "createdAt" date not null, "revoked" date, "confirmation" text, "scopes" text not null);

create table "oauthConsent" ("id" text not null primary key, "clientId" text not null references "oauthClient" ("clientId") on delete cascade, "userId" text references "user" ("id") on delete cascade, "referenceId" text, "resources" text, "requestedUserInfoClaims" text, "scopes" text not null, "createdAt" date not null, "updatedAt" date not null);

create table "oauthClientAssertion" ("id" text not null primary key, "expiresAt" date not null);

create table "deviceCode" ("id" text not null primary key, "deviceCode" text not null, "userCode" text not null, "userId" text, "expiresAt" date not null, "status" text not null, "lastPolledAt" date, "pollingInterval" integer, "clientId" text, "scope" text, "resources" text, "oauthClientId" text);

create table "ssoProvider" ("id" text not null primary key, "issuer" text not null, "oidcConfig" text, "samlConfig" text, "userId" text not null references "user" ("id") on delete cascade, "providerId" text not null unique, "organizationId" text, "domain" text not null);

create table "scimConnectionBinding" ("id" text not null primary key, "connectionId" text not null, "connectionKey" text not null unique, "provisioningDomainId" text not null, "createdAt" date not null, "decommissionedAt" date, "decommissionStatus" text not null, "decommissionCursorUserId" text, "decommissionReconciledUserCount" integer not null, "decommissionBatchCount" integer not null, "decommissionRevision" integer not null, "decommissionCompletedAt" date, "decommissionLeaseId" text, "decommissionLeaseExpiresAt" date);

create table "scimIdentityTombstone" ("id" text not null primary key, "connectionId" text not null, "provisioningDomainId" text not null, "externalId" text not null, "externalIdKey" text not null unique, "userId" text not null references "user" ("id") on delete cascade, "profile" text not null, "deletedAt" date not null);

create table "scimSubject" ("id" text not null primary key, "userId" text not null unique references "user" ("id") on delete cascade, "profileSourceId" text, "revision" integer not null, "createdAt" date not null, "updatedAt" date not null);

create table "scimUser" ("id" text not null primary key, "connectionId" text not null, "provisioningDomainId" text not null, "userId" text not null references "user" ("id") on delete cascade, "connectionUserKey" text not null unique, "userName" text not null, "userNameKey" text not null unique, "primaryEmail" text not null, "workEmailValueIndex" text not null, "emailValueIndex" text not null, "displayName" text not null, "formattedName" text not null, "givenName" text, "familyName" text, "serializedEmails" text not null, "serializedAttributes" text, "externalId" text, "externalIdKey" text unique, "active" integer not null, "orderKey" text not null unique, "createdAt" date not null, "updatedAt" date not null);

create table "scimProjectionGrant" ("id" text not null primary key, "connectionId" text not null, "provisioningDomainId" text not null, "scimUserId" text not null references "scimUser" ("id") on delete cascade, "userId" text not null references "user" ("id") on delete cascade, "sourceKind" text not null, "sourceId" text not null, "sourceValue" text, "role" text not null, "grantKey" text not null unique, "createdAt" date not null, "updatedAt" date not null);

create table "scimGroup" ("id" text not null primary key, "connectionId" text not null, "provisioningDomainId" text not null, "revision" integer not null, "displayName" text not null, "displayNameKey" text not null unique, "externalId" text, "externalIdKey" text unique, "orderKey" text not null unique, "createdAt" date not null, "updatedAt" date not null);

create table "scimGroupMember" ("id" text not null primary key, "connectionId" text not null, "groupId" text not null references "scimGroup" ("id") on delete cascade, "scimUserId" text not null references "scimUser" ("id") on delete cascade, "membershipKey" text not null unique, "createdAt" date not null);

create index "session_userId_idx" on "session" ("userId");

create index "account_userId_idx" on "account" ("userId");

create index "verification_identifier_idx" on "verification" ("identifier");

create index "passkey_userId_idx" on "passkey" ("userId");

create index "passkey_credentialID_idx" on "passkey" ("credentialID");

create index "apikey_configId_idx" on "apikey" ("configId");

create index "apikey_referenceId_idx" on "apikey" ("referenceId");

create index "apikey_key_idx" on "apikey" ("key");

create index "oauthClient_userId_idx" on "oauthClient" ("userId");

create index "oauthClientResource_clientId_idx" on "oauthClientResource" ("clientId");

create index "oauthClientResource_resourceId_idx" on "oauthClientResource" ("resourceId");

create index "oauthRefreshToken_clientId_idx" on "oauthRefreshToken" ("clientId");

create index "oauthRefreshToken_sessionId_idx" on "oauthRefreshToken" ("sessionId");

create index "oauthRefreshToken_userId_idx" on "oauthRefreshToken" ("userId");

create index "oauthRefreshToken_authorizationCodeId_idx" on "oauthRefreshToken" ("authorizationCodeId");

create index "oauthAccessToken_clientId_idx" on "oauthAccessToken" ("clientId");

create index "oauthAccessToken_sessionId_idx" on "oauthAccessToken" ("sessionId");

create index "oauthAccessToken_userId_idx" on "oauthAccessToken" ("userId");

create index "oauthAccessToken_authorizationCodeId_idx" on "oauthAccessToken" ("authorizationCodeId");

create index "oauthAccessToken_refreshId_idx" on "oauthAccessToken" ("refreshId");

create index "oauthConsent_clientId_idx" on "oauthConsent" ("clientId");

create index "oauthConsent_userId_idx" on "oauthConsent" ("userId");

create index "scimConnectionBinding_connectionId_idx" on "scimConnectionBinding" ("connectionId");

create index "scimIdentityTombstone_connectionId_idx" on "scimIdentityTombstone" ("connectionId");

create index "scimIdentityTombstone_provisioningDomainId_idx" on "scimIdentityTombstone" ("provisioningDomainId");

create index "scimIdentityTombstone_userId_idx" on "scimIdentityTombstone" ("userId");

create index "scimSubject_profileSourceId_idx" on "scimSubject" ("profileSourceId");

create index "scimUser_connectionId_idx" on "scimUser" ("connectionId");

create index "scimUser_provisioningDomainId_idx" on "scimUser" ("provisioningDomainId");

create index "scimUser_userId_idx" on "scimUser" ("userId");

create index "scimProjectionGrant_connectionId_idx" on "scimProjectionGrant" ("connectionId");

create index "scimProjectionGrant_provisioningDomainId_idx" on "scimProjectionGrant" ("provisioningDomainId");

create index "scimProjectionGrant_scimUserId_idx" on "scimProjectionGrant" ("scimUserId");

create index "scimProjectionGrant_userId_idx" on "scimProjectionGrant" ("userId");

create index "scimGroup_connectionId_idx" on "scimGroup" ("connectionId");

create index "scimGroup_provisioningDomainId_idx" on "scimGroup" ("provisioningDomainId");

create index "scimGroupMember_connectionId_idx" on "scimGroupMember" ("connectionId");

create index "scimGroupMember_groupId_idx" on "scimGroupMember" ("groupId");

create index "scimGroupMember_scimUserId_idx" on "scimGroupMember" ("scimUserId");

create unique index "oauthClientResource_clientId_resourceId_uidx" on "oauthClientResource" ("clientId", "resourceId");

create unique index "deviceCode_deviceCode_uidx" on "deviceCode" ("deviceCode");

create unique index "deviceCode_userCode_uidx" on "deviceCode" ("userCode");