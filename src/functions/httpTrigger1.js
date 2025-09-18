const { app } = require('@azure/functions');

// MCP Server Implementation for Azure Functions
class MCPServer {
    constructor() {
        this.tools = new Map();
        this.resources = new Map();
        this.prompts = new Map();
        this.version = "2024-11-05";
        
        // Register default tools
        this.registerDefaultTools();
    }

    registerDefaultTools() {
        // Echo tool for testing
        this.tools.set('echo', {
            name: 'echo',
            description: 'Echo back the input text',
            inputSchema: {
                type: 'object',
                properties: {
                    text: {
                        type: 'string',
                        description: 'Text to echo back'
                    }
                },
                required: ['text']
            }
        });

        // Get current time tool
        this.tools.set('get_time', {
            name: 'get_time',
            description: 'Get the current date and time',
            inputSchema: {
                type: 'object',
                properties: {
                    timezone: {
                        type: 'string',
                        description: 'Timezone (optional)',
                        default: 'UTC'
                    }
                }
            }
        });

        // HTTP request tool
        this.tools.set('http_request', {
            name: 'http_request',
            description: 'Make HTTP requests to external APIs',
            inputSchema: {
                type: 'object',
                properties: {
                    url: {
                        type: 'string',
                        description: 'URL to make request to'
                    },
                    method: {
                        type: 'string',
                        enum: ['GET', 'POST', 'PUT', 'DELETE'],
                        default: 'GET'
                    },
                    headers: {
                        type: 'object',
                        description: 'HTTP headers'
                    },
                    body: {
                        type: 'string',
                        description: 'Request body for POST/PUT'
                    }
                },
                required: ['url']
            }
        });
    }

    async handleInitialize(params) {
        return {
            protocolVersion: this.version,
            capabilities: {
                tools: {
                    listChanged: true
                },
                resources: {
                    subscribe: true,
                    listChanged: true
                },
                prompts: {
                    listChanged: true
                },
                logging: {}
            },
            serverInfo: {
                name: "Azure Functions MCP Server",
                version: "1.0.0"
            }
        };
    }

    async handleListTools() {
        return {
            tools: Array.from(this.tools.values())
        };
    }

    async handleCallTool(name, arguments_) {
        const tool = this.tools.get(name);
        if (!tool) {
            throw new Error(`Unknown tool: ${name}`);
        }

        switch (name) {
            case 'echo':
                return {
                    content: [{
                        type: 'text',
                        text: `Echo: ${arguments_.text || 'No text provided'}`
                    }]
                };

            case 'get_time':
                const now = new Date();
                const timezone = arguments_.timezone || 'UTC';
                return {
                    content: [{
                        type: 'text',
                        text: `Current time (${timezone}): ${now.toISOString()}`
                    }]
                };

            case 'http_request':
                try {
                    const fetch = (await import('node-fetch')).default;
                    const response = await fetch(arguments_.url, {
                        method: arguments_.method || 'GET',
                        headers: arguments_.headers || {},
                        body: arguments_.body || undefined
                    });
                    
                    const data = await response.text();
                    return {
                        content: [{
                            type: 'text',
                            text: `HTTP ${response.status}: ${data}`
                        }]
                    };
                } catch (error) {
                    return {
                        content: [{
                            type: 'text',
                            text: `HTTP Request failed: ${error.message}`
                        }],
                        isError: true
                    };
                }

            default:
                throw new Error(`Tool ${name} not implemented`);
        }
    }

    async handleListResources() {
        return {
            resources: Array.from(this.resources.values())
        };
    }

    async handleListPrompts() {
        return {
            prompts: Array.from(this.prompts.values())
        };
    }

    async handleRequest(request) {
        try {
            switch (request.method) {
                case 'initialize':
                    return await this.handleInitialize(request.params);
                
                case 'tools/list':
                    return await this.handleListTools();
                
                case 'tools/call':
                    return await this.handleCallTool(
                        request.params.name, 
                        request.params.arguments || {}
                    );
                
                case 'resources/list':
                    return await this.handleListResources();
                
                case 'prompts/list':
                    return await this.handleListPrompts();
                
                case 'ping':
                    return {}; // Simple ping/pong
                
                default:
                    throw new Error(`Unknown method: ${request.method}`);
            }
        } catch (error) {
            return {
                error: {
                    code: -32603,
                    message: error.message
                }
            };
        }
    }

    createStreamingResponse(request, context) {
        return {
            status: 200,
            headers: {
                'Content-Type': 'text/plain; charset=utf-8',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Transfer-Encoding': 'chunked'
            },
            body: this.generateStreamContent(request, context)
        };
    }

    async *generateStreamContent(request, context) {
        try {
            // Parse the MCP request
            const mcpRequest = JSON.parse(await request.text());
            context.log(`Processing MCP request: ${mcpRequest.method}`);

            // Handle the request
            const result = await this.handleRequest(mcpRequest);

            // For streaming responses, we can send partial results
            if (mcpRequest.method === 'tools/call') {
                // Simulate streaming for tool calls
                const chunks = this.chunkResponse(result);
                for (const chunk of chunks) {
                    yield `data: ${JSON.stringify(chunk)}\n\n`;
                    // Small delay to simulate processing
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            } else {
                // Send complete response for other methods
                yield `data: ${JSON.stringify(result)}\n\n`;
            }
            
            yield `data: [DONE]\n\n`;

        } catch (error) {
            context.log.error('MCP Server error:', error);
            yield `data: ${JSON.stringify({
                error: {
                    code: -32603,
                    message: error.message
                }
            })}\n\n`;
        }
    }

    chunkResponse(result) {
        // Break response into chunks for streaming
        if (result.content && result.content[0] && result.content[0].text) {
            const text = result.content[0].text;
            const chunkSize = Math.max(1, Math.floor(text.length / 5));
            const chunks = [];
            
            for (let i = 0; i < text.length; i += chunkSize) {
                chunks.push({
                    content: [{
                        type: 'text',
                        text: text.slice(i, i + chunkSize)
                    }],
                    partial: i + chunkSize < text.length
                });
            }
            
            return chunks;
        }
        
        return [result];
    }
}

// Create MCP server instance
const mcpServer = new MCPServer();

// Azure Function HTTP trigger
app.http('httpTrigger1', {
    methods: ['GET', 'POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        context.log(`MCP Server processed request for url "${request.url}"`);

        try {
            // Handle different endpoints
            const url = new URL(request.url);
            const pathname = url.pathname;

            // Health check endpoint
            if (request.method === 'GET' && pathname.includes('/health')) {
                return {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        status: 'healthy',
                        server: 'Azure Functions MCP Server',
                        version: '1.0.0',
                        timestamp: new Date().toISOString()
                    })
                };
            }

            // MCP capabilities endpoint
            if (request.method === 'GET' && pathname.includes('/capabilities')) {
                return {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        protocolVersion: mcpServer.version,
                        capabilities: {
                            tools: { listChanged: true },
                            resources: { subscribe: true, listChanged: true },
                            prompts: { listChanged: true },
                            logging: {}
                        }
                    })
                };
            }

            // MCP streaming endpoint
            if (request.method === 'POST' && pathname.includes('/mcp/stream')) {
                return mcpServer.createStreamingResponse(request, context);
            }

            // Standard MCP endpoint
            if (request.method === 'POST' && pathname.includes('/mcp')) {
                const requestBody = await request.text();
                const mcpRequest = JSON.parse(requestBody);
                
                context.log('MCP Request:', JSON.stringify(mcpRequest, null, 2));
                
                const result = await mcpServer.handleRequest(mcpRequest);
                
                return {
                    status: 200,
                    headers: { 
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                        'Access-Control-Allow-Headers': 'Content-Type'
                    },
                    body: JSON.stringify(result)
                };
            }

            // Default endpoint (backwards compatibility)
            const name = request.query.get('name') || 'world';
            return { 
                body: `Hello, ${name}! This is now an MCP Server. Try POST /api/httpTrigger1/mcp with MCP requests.` 
            };

        } catch (error) {
            context.log.error('Error:', error);
            return {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    error: 'Internal Server Error',
                    message: error.message
                })
            };
        }
    }
});

// Export for testing
module.exports = { MCPServer };