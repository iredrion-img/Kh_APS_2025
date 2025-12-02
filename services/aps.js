const { AuthenticationClient, ResponseType } = require('@aps_sdk/authentication');
const { DataManagementClient } = require('@aps_sdk/data-management');
const { APS_CLIENT_ID, APS_CLIENT_SECRET, APS_CALLBACK_URL, INTERNAL_TOKEN_SCOPES, PUBLIC_TOKEN_SCOPES } = require('../config.js');
const tokenStore = require('./tokenStore');

const authenticationClient = new AuthenticationClient();
const dataManagementClient = new DataManagementClient();
const service = module.exports = {};

service.getAuthorizationUrl = (state) => {
    const url = authenticationClient.authorize(APS_CLIENT_ID, ResponseType.Code, APS_CALLBACK_URL, INTERNAL_TOKEN_SCOPES);
    if (!state) {
        return url;
    }
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}state=${encodeURIComponent(state)}`;
};

service.authCallbackMiddleware = async (req, res, next) => {
    try {
        const expectedState = req.session?.oauth_state;
        if (!expectedState || req.query.state !== expectedState) {
            return res.status(400).send('Invalid OAuth state');
        }
        delete req.session.oauth_state;
        const sessionId = tokenStore.ensureSessionId(req);
        const internalCredentials = await authenticationClient.getThreeLeggedToken(APS_CLIENT_ID, req.query.code, APS_CALLBACK_URL, {
            clientSecret: APS_CLIENT_SECRET
        });
        const publicCredentials = await authenticationClient.refreshToken(internalCredentials.refresh_token, APS_CLIENT_ID, {
            clientSecret: APS_CLIENT_SECRET,
            scopes: PUBLIC_TOKEN_SCOPES
        });
        tokenStore.setTokens(sessionId, {
            internalAccessToken: internalCredentials.access_token,
            internalRefreshToken: internalCredentials.refresh_token,
            publicAccessToken: publicCredentials.access_token,
            publicRefreshToken: publicCredentials.refresh_token,
            expiresAt: Date.now() + internalCredentials.expires_in * 1000
        });
        next();
    } catch (err) {
        next(err);
    }
};

service.authRefreshMiddleware = async (req, res, next) => {
    try {
        const sessionId = tokenStore.getSessionId(req);
        if (!sessionId) {
            return res.status(401).end();
        }
        let tokens = tokenStore.getTokens(sessionId);
        if (!tokens || !tokens.internalRefreshToken || !tokens.publicRefreshToken) {
            return res.status(401).end();
        }
        if (!tokens.expiresAt || tokens.expiresAt <= Date.now()) {
            const internalCredentials = await authenticationClient.refreshToken(tokens.internalRefreshToken, APS_CLIENT_ID, {
                clientSecret: APS_CLIENT_SECRET,
                scopes: INTERNAL_TOKEN_SCOPES
            });
            const publicCredentials = await authenticationClient.refreshToken(tokens.publicRefreshToken, APS_CLIENT_ID, {
                clientSecret: APS_CLIENT_SECRET,
                scopes: PUBLIC_TOKEN_SCOPES
            });
            tokens = {
                internalAccessToken: internalCredentials.access_token,
                internalRefreshToken: internalCredentials.refresh_token,
                publicAccessToken: publicCredentials.access_token,
                publicRefreshToken: publicCredentials.refresh_token,
                expiresAt: Date.now() + internalCredentials.expires_in * 1000
            };
            tokenStore.setTokens(sessionId, tokens);
        }
        const expiresIn = Math.max(0, Math.round((tokens.expiresAt - Date.now()) / 1000));
        req.internalOAuthToken = {
            access_token: tokens.internalAccessToken,
            expires_in: expiresIn,
        };
        req.publicOAuthToken = {
            access_token: tokens.publicAccessToken,
            expires_in: expiresIn,
        };
        next();
    } catch (err) {
        next(err);
    }
};

service.getUserProfile = async (accessToken) => {
    const resp = await authenticationClient.getUserInfo(accessToken);
    return resp;
};

service.getHubs = async (accessToken) => {
    const resp = await dataManagementClient.getHubs({ accessToken });
    return resp.data;
};

service.getProjects = async (hubId, accessToken) => {
    const resp = await dataManagementClient.getHubProjects(hubId, { accessToken });
    return resp.data;
};

service.getProjectContents = async (hubId, projectId, folderId, accessToken) => {
    if (!folderId) {
        const resp = await dataManagementClient.getProjectTopFolders(hubId, projectId, { accessToken });
        return resp.data;
    } else {
        const resp = await dataManagementClient.getFolderContents(projectId, folderId, { accessToken });
        return resp.data;
    }
};

service.getItemVersions = async (projectId, itemId, accessToken) => {
    const resp = await dataManagementClient.getItemVersions(projectId, itemId, { accessToken });
    return resp.data;
};
