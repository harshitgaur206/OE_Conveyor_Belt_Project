#!/usr/bin/env bash
# Sets up backend/.venv and installs the correct torch build (GPU or CPU)
# depending on whether an NVIDIA GPU is present on this machine.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d ".venv" ]; then
    python3 -m venv .venv
fi

PIP=".venv/bin/pip"

"$PIP" install --upgrade pip

if command -v nvidia-smi &> /dev/null; then
    echo "NVIDIA GPU detected - installing CUDA-enabled torch build."
    "$PIP" install torch torchvision --index-url https://download.pytorch.org/whl/cu121
else
    echo "No NVIDIA GPU detected - installing CPU-only torch build."
    "$PIP" install torch torchvision
fi

"$PIP" install -r requirements.txt

".venv/bin/python" -c "import torch; print(f'torch {torch.__version__} | CUDA available: {torch.cuda.is_available()}')"
