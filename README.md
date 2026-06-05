<div align="center">

# 🎬 CutFlow AI

**The Ultimate Cross-Platform, Local-First AI Video Editor**

![Tauri](https://img.shields.io/badge/Tauri-FFC131?style=for-the-badge&logo=Tauri&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)

</div>

---

## ✨ Overview

**CutFlow AI** is a next-generation video editor designed for speed, privacy, and automation. By leveraging local AI models, it takes the tedious work out of video editing—giving you professional results without ever sending your media to the cloud.

Built on the blazing-fast **Tauri + Rust** backend and a sleek **React** frontend, CutFlow AI is heavily optimized for high-concurrency processing, making it perfect for handling large video files locally.

## 🚀 Key Features

- **✂️ AI Silence Skipping**: Automatically detects and cuts out dead air and pauses, saving you hours of manual trimming.
- **💬 Dynamic Smart Subtitles**: Premium typography powered by Google Fonts, complete with word-by-word active highlighting. Features the bouncing **Claude Code Crab** 🦀 for an engaging viewer experience!
- **🎞️ Professional Multi-Track Timeline**: A robust non-linear editing deck featuring dedicated tracks for Subtitles, B-Roll, Video, and Audio.
- **🎭 Face-Aware Framing**: Intelligent face detection automatically adjusts subtitle positioning so you never block the speaker's face.
- **🔒 Local-First Architecture**: All transcription (via Whisper), face tracking, and rendering happens entirely on your machine. Complete privacy.
- **⚡ Hardware Accelerated**: Uses WebGPU and SIMD-threaded WASM for lightning-fast AI inference right in the desktop app.

## 🛠️ Tech Stack

- **Backend core**: Rust & Tauri 2.0
- **Frontend**: React 18, TypeScript, Vite
- **Styling**: Vanilla CSS, Framer Motion for buttery smooth micro-animations
- **AI Models**: 
  - Whisper (Transcription)
  - YOLOv8 (Face Detection via ONNX Runtime Web)

## 📦 Getting Started

### Prerequisites
Make sure you have the following installed:
- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://www.rust-lang.org/tools/install) (latest stable)
- Build tools (Visual Studio C++ Build Tools for Windows, Xcode for macOS, etc.)

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/sterbendos/cutflow-ai.git
   cd cutflow-ai
   ```

2. **Install frontend dependencies:**
   ```bash
   npm install
   ```

3. **Run the development server:**
   ```bash
   npm run tauri dev
   ```

## 🎮 How to Use
1. **Import Media**: Simply drag and drop your video files into the Asset Browser.
2. **Auto-Cut**: Let CutFlow AI analyze the video and automatically skip silences.
3. **Add B-Roll**: Add videos as B-Roll overlay clips with a single click in the library.
4. **Style Subtitles**: Open the Caption Editor to tweak fonts, colors, and toggle the Claude crab!
5. **Export**: Export your fully customized video with burned-in subtitles directly to your local drive.

---

<div align="center">
  <i>Built with ❤️ for creators who value speed and privacy.</i>
</div>