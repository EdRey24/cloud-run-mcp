#!/usr/bin/env node

/*
Copyright 2025 Google LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import express from 'express';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
// Support SSE for backward compatibility
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
// Support stdio, as it is easier to use locally
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools, registerToolsRemote } from './tools.js';
import { checkGCP } from './lib/gcp-metadata.js';
import { listProjects } from './lib/gcp-projects.js'; // Import listProjects
import 'dotenv/config';

const gcpInfo = await checkGCP();

// Using unhandled exceptions to catch when ADC isn't set
process.on('uncaughtException', (err) => {
  console.error('CRITICAL ERROR: Cloud Run MCP server encountered an uncaught exception.');
  console.error(`Details: ${err.message}`);
  console.error('Likely to resolve this, please ensure your Google Cloud Application Default Credentials (ADC) are set up correctly by running:');
  console.error('gcloud auth application-default login');
  process.exit(1); // Exit with a failure code
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('CRITICAL ERROR: Cloud Run MCP server encountered an unhandled promise rejection.');
  console.error(`Details: ${reason instanceof Error ? reason.message : reason}`);
  console.error('Likely to resolve this, please ensure your Google Cloud Application Default Credentials (ADC) are set up correctly by running:');
  console.error('gcloud auth application-default login');
  process.exit(1); // Exit with a failure code
});


/**
 * Checks for local Application Default Credentials by attempting a simple Google Cloud API call.
 * @returns {Promise<boolean>} True if ADC is likely configured and functional.
 */
async function checkLocalAdcStatusWithApiCall() {
  // Attempt a simple API call to check if credentials are working.
  // listProjects will now throw an error if authentication fails or permissions are denied.
  // A timeout is added to prevent indefinite waiting if something hangs.
  await Promise.race([
    listProjects(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('API call timeout for ADC check')), 10000)) // 10 seconds timeout
  ]);
  return true; // If listProjects succeeds (or resolves within timeout), ADC is working.
}

// Logic to determine and print the appropriate authentication message
if (gcpInfo && gcpInfo.project) {
  // Running on GCP (e.g., Cloud Run, GCE)
  console.log(`Running on Google Cloud Platform (Project: ${gcpInfo.project}, Region: ${gcpInfo.region}). Service account credentials are used for authentication.`);
} else {
  // Not running on GCP, check for local ADC by attempting an API call
  const hasFunctionalLocalAdc = await checkLocalAdcStatusWithApiCall();
  if (hasFunctionalLocalAdc) {
    console.log('Detected functional local Google Cloud Application Default Credentials. Ready for local development.');
  } else {
    // gcloud CLI might not be installed or ADC not set up
    console.log('To authenticate with Google Cloud for local development, please ensure the gcloud CLI is installed and run: gcloud auth application-default login');
  }
}


/**
 * Ensure that console.log and console.error are compatible with stdio.
 * (Right now, it just disables them)
 */
function makeLoggingCompatibleWithStdio() {
  // redirect all console.log (which usually go to to stdout) to stderr.
  console.log = console.error;
}

function shouldStartStdio() {
  if (process.env.GCP_STDIO) {
    return true;
  }
  if (gcpInfo && gcpInfo.project) {
    return false;
  }
  return true;
}

if (shouldStartStdio()) {
  makeLoggingCompatibleWithStdio();
};

// Read default configurations from environment variables
const envProjectId = process.env.GOOGLE_CLOUD_PROJECT || undefined;
const envRegion = process.env.GOOGLE_CLOUD_REGION;
const defaultServiceName = process.env.DEFAULT_SERVICE_NAME;
const skipIamCheck = process.env.SKIP_IAM_CHECK === 'false'; // Convert string to boolean

async function getServer() {
  // Create an MCP server with implementation details
  const server = new McpServer({
    name: 'cloud-run',
    version: '1.0.0',
  }, { capabilities: { logging: {} } });

  // Determine the effective project and region based on priority: Env Var > GCP Metadata > Hardcoded default
  const effectiveProjectId = envProjectId || (gcpInfo && gcpInfo.project) || undefined;
  const effectiveRegion = envRegion || (gcpInfo && gcpInfo.region) || 'europe-west1';

  if (shouldStartStdio() || !(gcpInfo && gcpInfo.project)) {
    console.log('Using tools optimized for local or stdio mode.');
    // Pass the determined defaults to the local tool registration
    await registerTools(server, {
      defaultProjectId: effectiveProjectId,
      defaultRegion: effectiveRegion,
      defaultServiceName,
      skipIamCheck
    });
  } else {
    console.log(`Running on GCP project: ${effectiveProjectId}, region: ${effectiveRegion}. Using tools optimized for remote use.`);
    // Pass the determined defaults to the remote tool registration
    await registerToolsRemote(server, {
      defaultProjectId: effectiveProjectId,
      defaultRegion: effectiveRegion,
      defaultServiceName,
      skipIamCheck
    });
  }

  return server;
}

// stdio
if (shouldStartStdio()) {
  const stdioTransport = new StdioServerTransport();
  const server = await getServer();
  await server.connect(stdioTransport);
  console.log('Cloud Run MCP server stdio transport connected');
} else {
  console.log('Running on GCP, stdio transport will not be started.');

  const app = express();
  app.use(express.json());

  app.post('/mcp', async (req, res) => {
    console.log('/mcp Received:', req.body);
    const server = await getServer();
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on('close', () => {
        console.log('Request closed');
        transport.close();
        server.close();
      });
    } catch (error) {
      console.error('Error handling MCP request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
          },
          id: null,
        });
      }
    }
  });

  app.get('/mcp', async (req, res) => {
    console.log('Received GET MCP request');
    res.writeHead(405).end(JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed."
      },
      id: null
    }));
  });

  app.delete('/mcp', async (req, res) => {
    console.log('Received DELETE MCP request');
    res.writeHead(405).end(JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Method not allowed."
      },
      id: null
    }));
  });

  // Support SSE for baackward compatibility
  const sseTransports = {};

  // Legacy SSE endpoint for older clients
  app.get('/sse', async (req, res) => {
    console.log('/sse Received:', req.body);
    const server = await getServer();
    // Create SSE transport for legacy clients
    const transport = new SSEServerTransport('/messages', res);
    sseTransports[transport.sessionId] = transport;

    res.on("close", () => {
      delete sseTransports[transport.sessionId];
    });

    await server.connect(transport);
  });

  app.post('/messages', async (req, res) => {
    console.log('/messages Received:', req.body);
    const sessionId = req.query.sessionId;
    const transport = sseTransports[sessionId];
    if (transport) {
      await transport.handlePostMessage(req, res, req.body);
    } else {
      res.status(400).send('No transport found for sessionId');
    }
  });

  // Start the server
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Cloud Run MCP server listening on port ${PORT}`);
  });
}

// Handle server shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down server...');
  process.exit(0);
});