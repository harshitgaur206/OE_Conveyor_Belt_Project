# Sets up backend/.venv and installs the correct torch build (GPU or CPU)
# depending on whether an NVIDIA GPU is present on this machine.

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path ".venv")) {
    python -m venv .venv
}

$pip = ".venv\Scripts\pip.exe"

& $pip install --upgrade pip

$hasNvidiaGpu = $null -ne (Get-Command nvidia-smi -ErrorAction SilentlyContinue)

if ($hasNvidiaGpu) {
    Write-Host "NVIDIA GPU detected - installing CUDA-enabled torch build."
    & $pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
} else {
    Write-Host "No NVIDIA GPU detected - installing CPU-only torch build."
    & $pip install torch torchvision
}

& $pip install -r requirements.txt

& ".venv\Scripts\python.exe" -c "import torch; print(f'torch {torch.__version__} | CUDA available: {torch.cuda.is_available()}')"
