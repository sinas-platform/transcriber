const CONFIG_API_PREFIX = '/api/v1'

function encode(value: string): string {
  return encodeURIComponent(value)
}

export const endpoints = {
  auth: {
    login: '/auth/login',
    verifyOtp: '/auth/verify-otp',
    refresh: '/auth/refresh',
    logout: '/auth/logout',
    me: '/auth/me',
    checkPermissions: '/auth/check-permissions',
  },

  chats: {
    list: '/chats',
    byId: (chatId: string) => `/chats/${encode(chatId)}`,
    update: (chatId: string) => `/chats/${encode(chatId)}`,
    remove: (chatId: string) => `/chats/${encode(chatId)}`,
    messages: (chatId: string) => `/chats/${encode(chatId)}/messages`,
    streamMessages: (chatId: string) => `/chats/${encode(chatId)}/messages/stream`,
    streamChannel: (chatId: string, channelId: string) =>
      `/chats/${encode(chatId)}/stream/${encode(channelId)}`,
    approveTool: (chatId: string, toolCallId: string) =>
      `/chats/${encode(chatId)}/approve-tool/${encode(toolCallId)}`,
    createForAgent: (namespace: string, agentName: string) =>
      `/agents/${encode(namespace)}/${encode(agentName)}/chats`,
    invokeAgent: (namespace: string, agentName: string) =>
      `/agents/${encode(namespace)}/${encode(agentName)}/invoke`,
    defaultAgent: '/agents/default',
  },

  config: {
    agents: `${CONFIG_API_PREFIX}/agents`,
    agentByName: (namespace: string, name: string) =>
      `${CONFIG_API_PREFIX}/agents/${encode(namespace)}/${encode(name)}`,
    messages: `${CONFIG_API_PREFIX}/messages`,
    messageStats: `${CONFIG_API_PREFIX}/messages/stats`,
    skills: `${CONFIG_API_PREFIX}/skills`,
    functions: `${CONFIG_API_PREFIX}/functions`,
    stores: `${CONFIG_API_PREFIX}/stores`,
    collections: `${CONFIG_API_PREFIX}/collections`,
    templates: `${CONFIG_API_PREFIX}/templates`,
  },

  files: {
    root: '/files',
    file: (namespace: string, collection: string, filename: string) =>
      `/files/${encode(namespace)}/${encode(collection)}/${encode(filename)}`,
    publicFile: (namespace: string, collection: string, filename: string) =>
      `/files/public/${encode(namespace)}/${encode(collection)}/${encode(filename)}`,
  },
} as const
