const { SystemRoles } = require('librechat-data-provider');
const { getAssistant } = require('~/models/Assistant');

/**
 * Checks if the assistant is supported or excluded
 * @param {object} params
 * @param {object} params.req - Express Request
 * @param {object} params.req.body - The request payload.
 * @param {string} params.overrideEndpoint - The override endpoint
 * @param {string} params.overrideAssistantId - The override assistant ID
 * @param {OpenAIClient} params.openai - OpenAI API Client
 * @param {boolean} params.isDelete - Whether this is a delete operation
 * @returns {Promise<void>}
 */
const validateAuthor = async ({ req, openai, overrideEndpoint, overrideAssistantId, isDelete = false }) => {
  if (req.user.role === SystemRoles.ADMIN) {
    return;
  }

  // Try to get the endpoint from various sources
  let endpoint = overrideEndpoint;
  if (!endpoint) {
    endpoint = req.body.endpoint;
  }
  if (!endpoint) {
    endpoint = req.query.endpoint;
  }

  // If still no endpoint, try to get it from the URL path
  if (!endpoint) {
    const pathParts = req.originalUrl.split('/');
    if (pathParts.includes('v1') || pathParts.includes('v2')) {
      endpoint = 'assistants';
    } else if (pathParts.includes('azure')) {
      endpoint = 'azureAssistants';
    }
  }

  const assistant_id =
    overrideAssistantId ?? req.params.id ?? req.body.assistant_id ?? req.query.assistant_id;

  /** @type {Partial<TAssistantEndpoint>} */
  const assistantsConfig = req.app.locals?.[endpoint];
  if (!assistantsConfig) {
    return;
  }

  if (!assistantsConfig.privateAssistants) {
    return;
  }

  // For delete operations, check all endpoints to prevent deletion of supported assistants by non-admin users
  if (isDelete) {
    // Check all endpoints for supportedIds
    const allEndpoints = Object.keys(req.app.locals || {});

    for (const endpointKey of allEndpoints) {
      const config = req.app.locals[endpointKey];

      if (config?.supportedIds?.length) {
        // Check if the assistant_id is in the supportedIds list
        const isSupported = config.supportedIds.some(id => id === assistant_id);

        if (isSupported) {
          throw new Error(`Cannot delete assistant ${assistant_id} as it is a company assistant.`);
        }
      }
    }
  }

  // Allow assistants explicitly listed in supportedIds regardless of author for non-delete operations
  if (!isDelete && assistantsConfig.supportedIds?.length && assistantsConfig.supportedIds.includes(assistant_id)) {
    return;
  }

  const assistantDoc = await getAssistant({ assistant_id, user: req.user.id });
  if (assistantDoc) {
    return;
  }
  const assistant = await openai.beta.assistants.retrieve(assistant_id);
  if (req.user.id !== assistant?.metadata?.author) {
    throw new Error(`Assistant ${assistant_id} is not authored by the user.`);
  }
};

module.exports = validateAuthor;
