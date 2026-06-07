# 🦷 Dental Dashboard

An AI-assisted dental radiography workspace for reviewing panoramic OPG images, generating a simulated 3D CBCT-style scaffold, annotating findings, and sending image context to an OpenAI-compatible vision model for structured radiology support.

This repository now contains three related pieces:

- `src/`: the React/Vite dashboard.
- `mcp/`: a medical/dental Model Context Protocol server with HTTP and stdio transports.
- `wandb-trainer/`: a QLoRA supervised fine-tuning starter for dental/medical instruction data.

> Safety note: this project is for research, education, prototyping, and workflow exploration. It must not be used as the sole basis for diagnosis, treatment, triage, or other clinical decisions.

## Key Features

- **OPG upload and profiling**: drop in a panoramic X-ray image and compute local visual metrics for panoramic fit, symmetry, contrast, entropy, and edge detail.
- **Simulated CBCT viewer**: generate an interactive Three.js dental arch/scaffold from the OPG-derived profile.
- **3D controls**: orbit, pan, zoom, spin, reset, wireframe, slice, floor, frame, and scaffold views.
- **Annotation tools**: draw, fill, erase, and pin notes directly on the simulated 3D scene.
- **AI analysis panel**: send the full OPG or a selected rendered 3D crop to a streaming OpenAI-compatible chat-completions endpoint.
- **Workflow persistence**: export and import a single JSON workflow containing the embedded OPG image, model metadata, annotations, fills, and chat history.
- **Medical MCP server**: expose drug, literature, global health, pediatric, and cache-monitoring tools through stdio or streamable HTTP.
- **Fine-tuning starter**: train a lightweight dental assistant model with TRL, PEFT/QLoRA, W&B, and Weave.

## App Tech Stack

- **Frontend**: React 18, TypeScript, Vite 6.
- **3D rendering**: Three.js/WebGL.
- **Styling**: Tailwind CSS plus app-specific CSS.
- **Icons**: Lucide React.
- **AI API shape**: OpenAI-compatible `POST /v1/chat/completions` with streaming responses and image-message content.
- **MCP package**: TypeScript, `@modelcontextprotocol/sdk`, Express, CORS, Redis, Superagent, Puppeteer, Zod, Jest.

## Quick Start

Install and run the dashboard:

```bash
npm install
npm run dev
```

Build the dashboard:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## ⚙️ Configure AI Analysis

Open the dashboard, click the settings button, and enter:

- **Model Endpoint**: an OpenAI-compatible chat completions URL. The default is `http://127.0.0.1:8888/v1/chat/completions`.
- **API Key**: optional bearer token. Leave blank for local endpoints that do not require auth.
- **Model Identifier**: the model name expected by the endpoint, such as `gpt-5.5`, `gemma-4`, etc., or/with a vision model identifier.

The dashboard sends requests with:

- `model`
- `messages`
- `max_tokens: 2048`
- `temperature: 0.25`
- `stream: true`

Image inputs are sent using OpenAI-style multimodal message content with `image_url` data URLs. The UI reads Server-Sent Event style streaming chunks from `choices[0].delta.content`.

## 🤖 Medical/Dental MCP Server (Multi-agent Orchestration Workflow)

The `mcp/` package is a standalone Model Context Protocol server for medical and dental context tools. It can run locally over stdio for agent/IDE clients, or over streamable HTTP for web runtimes such as CopilotKit.

Install, build, and test it from the `mcp/` folder:

```bash
cd mcp
npm install
npm run build
npm test
```

Run with stdio:

```bash
npm run start
```

Run with HTTP:

```bash
npm run start:http -- --port=3000
```

Useful HTTP endpoints:

- MCP endpoint: `http://localhost:3000/mcp`
- Health/config metadata: `http://localhost:3000/health`

The MCP server includes tools for FDA drug data, RxNorm nomenclature, PubMed literature, Google Scholar-style research lookups, WHO health statistics, pediatric guidelines, multi-database search, and cache statistics. See `mcp/README.md` for the full tool list.

## Tech Specs: OpenAI

The dashboard does not depend on the official OpenAI SDK. It uses direct `fetch` calls against any endpoint that follows the OpenAI chat-completions request and streaming response format.

This is intentional for broad compatibility with OpenAI, OpenAI-compatible gateways, and local model servers. For new OpenAI-native builds, the Responses API may be worth evaluating separately, but this dashboard currently targets chat-completions compatibility.

Current behavior:

- Full OPG analysis sends a system prompt plus the uploaded OPG as an `image_url` data URL.
- Follow-up chat preserves prior API messages and can attach the OPG when starting from a fresh thread.
- Capture analysis sends a selected PNG crop from the rendered 3D viewer and explicitly labels it as a simulated CBCT viewer crop, not raw DICOM.
- If an API key is present, it is sent as `Authorization: Bearer <key>`.

Compatible targets include OpenAI, OpenAI-compatible gateways, and local vision model servers that implement streaming chat completions.

## Tech Specs: Cursor 💎

Cursor can use the `mcp/` server as a local MCP provider after the MCP package has been built.

Example stdio MCP config:

```json
{
  "mcpServers": {
    "medical-dental": {
      "command": "node",
      "args": [
        "C:/Users/<username>/git-dashboard/mcp/build/index.js"
      ]
    }
  }
}
```

For HTTP-capable MCP clients, start the server with `npm run start:http -- --port=3000` from `mcp/` and point the client at `http://localhost:3000/mcp`.

## Tech Specs: Redis 💾

The MCP server uses an in-memory cache by default. Redis is optional and is used when a Redis URL is provided.

Example:

```bash
cd mcp
REDIS_URL=redis://localhost:6379 npm run start:http -- --port=3000
```

PowerShell equivalent:

```powershell
cd mcp
$env:REDIS_URL="redis://localhost:6379"
npm run start:http -- --port=3000
```

Supported cache environment variables:

```bash
CACHE_ENABLED=true
CACHE_BACKEND=redis
REDIS_URL=redis://localhost:6379
REDIS_CACHE_ENABLED=true
REDIS_CACHE_PREFIX=medical-mcp:cache:
REDIS_CONNECT_TIMEOUT_MS=5000
```

If Redis cannot be reached, the server logs the error and falls back to memory cache. Cache status is included in the `/health` response.

## Tech Specs: CopilotKit 🪁

CopilotKit should connect to the MCP server through the streamable HTTP endpoint.

Start the MCP server:

```bash
cd mcp
npm run start:http -- --port=3000
```

Example CopilotKit runtime config:

```ts
import { BuiltInAgent } from "@copilotkit/runtime/v2";

export const builtInAgent = new BuiltInAgent({
  model: "openai:gpt-5.4-mini",
  mcpServers: [
    {
      type: "http",
      url: "http://localhost:3000/mcp",
    },
  ],
});
```

The server's `/health` response also returns a CopilotKit-ready `mcpServers` array for the current host and port.

## Fine-Tuning Starter 🐝

The `wandb-trainer/` folder contains a QLoRA SFT script and starter dataset:

- `trainer.py`
- `medical_dental_train.jsonl`
- `README.md`

Install the Python training dependencies:

```bash
pip install -U torch transformers datasets accelerate peft trl bitsandbytes wandb weave
wandb login
huggingface-cli login
```

Run from `wandb-trainer/`:

```bash
python trainer.py
```

Before training on clinical text, remove PHI/PII, keep answers cautious, and include clear guidance to consult a licensed dentist or clinician for patient-specific concerns.

## 🏗️ Project Structure

```text
.
|-- src/
|   |-- App.tsx              # Dashboard UI, OPG profiling, Three.js viewer, AI calls
|   |-- main.tsx             # React entry point
|   |-- styles.css           # Tailwind layers and app styles
|   `-- vite-env.d.ts
|-- mcp/
|   |-- src/                 # Medical MCP tools, cache, transports, types
|   |-- package.json         # MCP scripts and dependencies
|   `-- README.md
|-- wandb-trainer/
|   |-- trainer.py           # QLoRA SFT training script
|   |-- medical_dental_train.jsonl
|   `-- README.md
|-- index.html
|-- package.json
|-- tailwind.config.ts
|-- tsconfig.json
`-- vite.config.ts
```

## Development Notes

- Run the dashboard and MCP server in separate terminals when testing end-to-end agent workflows.
- The frontend AI panel talks directly to the configured chat-completions endpoint; it does not currently call the MCP server directly.
- The MCP server is intended for agent runtimes and IDE integrations that need authoritative medical context tools.
- Exported workflow JSON embeds image data and chat history, so treat exports as sensitive clinical-adjacent data.
=======
## 📋 Model Fine Tuning Script
- see folder `wandb-trainer`

![screenshot](https://raw.githubusercontent.com/mochiyaki/dental-dashboard/master/gpu_status.png)

## 📄 Tech Specs (see above)
- wandb/weave (model trainer/fine tuning) 🐝
- OpenAI, Cursor (coding and/or APIs) 💎
- Redis, CopilotKit (dataflow and/or mcp) 🪁

![screenshot](https://raw.githubusercontent.com/mochiyaki/dental-dashboard/master/mcp_setup.png)
