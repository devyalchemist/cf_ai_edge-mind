🧠 EdgeMind: Stateful Serverless AI
EdgeMind is a distributed, stateful AI chat application running entirely on Cloudflare’s Edge network. It solves the "stateless" problem of serverless functions by co-locating persistent memory with compute using Durable Objects, achieving low-latency context retrieval without external databases.

🔗 Live Demo: https://cloudflare-edge-ai-chat.devyalchemist.workers.dev

🏗️ Architecture
Unlike traditional architectures that decouple compute (Lambda) from storage (Postgres/Redis), EdgeMind unifies them. The application logic, UI delivery, and user state all exist within a single globally distributed Worker.

Code snippet

graph TD
User[Browser / Client] -->|HTTPS Request| Worker[Cloudflare Worker Gateway]

    subgraph "The Edge (Region: Nearest to User)"
        Worker -->|1. GET /| HTML[Serve Static UI]
        Worker -->|2. POST /chat| Router[Identity Router]

        Router -->|Route by Username| DO[Durable Object Shard]

        subgraph "Stateful Execution"
            DO -->|Load| SQL[SQLite Storage (History)]
            DO -->|Inference| AI[Workers AI (Llama 3.1)]
            AI -->|Stream Token| DO
            DO -->|Persist| SQL
        end
    end

    DO -->|JSON Response| Worker
    Worker -->|Reply| User

Key Components
The Brain (Workers AI): Utilizes Llama-3.1-8b-instruct for inference. We chose the 8B model for its balance of token generation speed and reasoning capability within the Free Tier constraints.

The Memory (Durable Objects): Acts as a dedicated "micro-database" for each user. It ensures strong consistency and allows the AI to remember context across sessions and devices.

The Gateway (Worker): Handles HTTP routing, serves the server-side rendered HTML, and manages the WebSocket/Fetch connections to the Durable Objects.

🚀 Features
🌍 True Edge Deployment: No origin servers. The entire stack runs on Cloudflare's global network.

💾 Persistent Context: Uses SQLite-backed Durable Objects to store conversation history. Memory survives page refreshes and device switches.

🔑 Identity-Based Routing: Implements a "Handle" system where the sessionId is derived from the username. This allows cross-device state synchronization (e.g., start on PC, continue on Mobile) without a complex OAuth backend.

⚡ Zero-Config Infrastructure: Infrastructure-as-Code is handled entirely via wrangler.toml.

🛠️ Tech Stack
Runtime: Cloudflare Workers (Node.js compat)

AI Model: Meta Llama 3.1 8B Instruct (@cf/meta/llama-3.1-8b-instruct)

State: Cloudflare Durable Objects (SQLite Backend)

Language: JavaScript (ES Modules)

Deployment: Wrangler CLI

⚡ Quick Start
Prerequisites
Node.js (v18+)

Cloudflare Account

1. Installation
   Bash

# Clone the repo (or create new)

npm create cloudflare@latest edge-mind -- --template worker
cd edge-mind

# Install dependencies

npm install 2. Configuration (wrangler.toml)
Ensure your configuration enables the AI binding and the SQLite storage backend (required for Free Tier):

Ini, TOML

[ai]
binding = "AI"

[[durable_objects.bindings]]
name = "CHAT_HISTORY"
class_name = "ChatRoom"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["ChatRoom"] 3. Develop Locally
To test the AI and Durable Objects, you must use the --remote flag to proxy requests to Cloudflare's network (since your laptop doesn't have H100 GPUs):

Bash

npx wrangler dev --remote 4. Deploy
Bash

npx wrangler deploy
🧠 Engineering Decisions & Trade-offs
Why Durable Objects instead of Redis?
While Redis is fast, it requires network hops to a centralized region (or expensive replication). Durable Objects allow us to instantiate the database directly next to the user. If a user is in Lagos, their chat history lives on a Cloudflare server in (or near) Lagos. This minimizes latency for the "Read-Modify-Write" cycle required for chat history.

Why "Simulated Auth"?
To focus on demonstrating distributed systems architecture rather than frontend boilerplate, we used an identity-based routing system. By hashing the username to a Durable Object ID, we achieve consistent hashing without the overhead of a centralized user database table.

🔮 Future Roadmap
Streaming Responses: Implement Response.body streaming to deliver tokens as they are generated (Typewriter effect).

Vector Search (RAG): Integrate Cloudflare Vectorize to allow the AI to recall information from conversations that happened weeks ago, bypassing the context window limit.

Secure Auth: Replace the username handle system with Cloudflare Access or OAuth for genuine security.

Built by DevyAlchemist for the Cloudflare Developer Challenge.
