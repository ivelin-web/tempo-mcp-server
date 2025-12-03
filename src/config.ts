/**
 * Configuration manager for the MCP server
 * Validates required environment variables and exports config settings
 */
import { envSchema, Config } from './types.js';
import { ZodError } from 'zod';

// Validate environment variables
function validateEnv() {
  try {
    // Parse and validate environment variables
    return envSchema.parse(process.env);
  } catch (error: unknown) {
    // Format and display validation errors
    console.error('[ERROR] Environment validation failed:');
    if (error instanceof ZodError) {
      error.errors.forEach((err) => {
        console.error(`- ${err.path.join('.')}: ${err.message}`);
      });
    } else {
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exit(1);
  }
}

// Get validated environment variables
const env = validateEnv();

// Application configuration with validated environment variables
const config: Config = {
  tempoApi: {
    baseUrl: 'https://api.tempo.io/4',
    token: env.TEMPO_API_TOKEN,
  },
  jiraApi: {
    baseUrl: env.JIRA_BASE_URL,
    token: env.JIRA_API_TOKEN,
    email: env.JIRA_EMAIL,
    authType: env.JIRA_AUTH_TYPE,
    tempoAccountCustomFieldId:
      env.JIRA_TEMPO_ACCOUNT_CUSTOM_FIELD_ID || undefined,
    tempoRoleCustomFieldId: env.JIRA_TEMPO_ROLE_CUSTOM_FIELD_ID || undefined,
  },
  server: {
    name: 'tempo-mcp-server',
    version: '1.0.0',
  },
};

export default config;
