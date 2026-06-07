# 🦷 Dental Workflow Dashboard

An advanced, AI-assisted web application for dental radiography analysis. This dashboard enables clinicians to upload panoramic X-rays (OPG), generate 3D simulated CBCT (Cone Beam Computed Tomography) scaffolds, and perform deep-dive radiologic analysis using large multimodal models (LMMs).

## 🚀 Key Features

- **OPG to 3D Simulation**: Automatically extracts anatomical features (symmetry, contrast, edge detail) from uploaded OPG images to parameterize and generate a 3D dental arch scaffold using Three.js.
- **AI-Powered Radiologic Analysis**: Integration with OpenAI-compatible endpoints (e.g., GPT-5.5, Claude, or eligible LLMs) to generate structured clinical reports, identify caries, assess bone levels, and analyze TMJ conditions.
- **Interactive 3D Viewer**: 
  - **Orbit/Pan/Zoom**: Full 3D manipulation of the dental scaffold.
  - **Annotation Suite**: Tools for drawing, placing notes, and color-filling specific tooth structures.
  - **Feature Toggles**: Enable/disable wireframes, dental slices, and anatomical landmarks.
- **Visual Region Analysis**: "Capture" specific segments of the 3D viewer to send cropped, high-resolution visual context to the AI for targeted inspection.
 
- **Workflow Persistence**: Export the entire session—including the OPG image, AI chat history, 3D annotations, and vertebral parameters—as a single, portable JSON workflow file.

## 🏗️ Architecture & Tech Stack

### Frontend
- **Framework**: [React](https://reactjs.org/) (TypeScript)
- **Build Tool**: [Vite](https://vitejs.dev/)
- **3D Engine**: [Three.js](https://threejs.org/) (WebGL-based rendering)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **Icons**: [Lucide React](https://lucide.dev/)

### Backend/AI Integration
- **Protocol**: OpenAI-compatible Chat Completions API.
- **Supported Models**: Any vision-capable model reachable via an HTTP endpoint.

## 🔄 Workflow

1.  **Upload**: Drop an OPG/Panoramic X-ray into the dashboard.
2.  **Feature Extraction**: The system computes an "OPG Profile" (Similarity, Discrimination, Linkage) based on the image's visual characteristics.
3.  **Generation**: A 3D dental arch scaffold is generated, simulating 3D anatomy based on the 2D input.
4.  **AI Analysis**: 
    - Use **Analyze OPG** to get a full-arch report.
    - Use **Capture CBCT** to select a specific area of interest for localized analysis.
5.  **Annotate**: Use the brush and note tools to highlight clinical findings.

6.  **Export**: Save the findings as a JSON file for clinical records.

## 🛠️ Setup & Installation

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/mochiyaki/dental-dashboard
    cd dental-dashboard
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

3.  **Running the development server**:
    ```bash
    npm run dev
    ```

4.  **Configure your AI provider**:
    - Open the dashboard in your browser.
    - Click on the **Settings** icon.
    - Enter your API **Endpoint** (e.g., `http://localhost:8888/v1/chat/completions`), **API Key**, and **Model Name**.

## 📁 Project Structure

```text
├── src/
│   ├── App.tsx          # Main application logic, 3D engine, and UI components
│   ├── main.tsx         # Application entry point
│   ├── styles.css       # Tailwind and custom global styles
│   └── vite-env.d.ts    # Vite type definitions
├── index.html           # HTML entry point
├── package.json         # Project dependencies and scripts
├── tailwind.config.ts   # Tailwind CSS configuration
└── tsconfig.json        # TypeScript configuration
```

## 📋 Model Fine Tuning Script
- see folder `wandb-trainer`

## 📄 Tech Specs
- OpenAI, Cursor (coding and/or APIs)
- Redis, CopilotKit (flow and/or mcp)

## 📑 TODO List
- build a medical MCP with Redis and CopilotKit
