#!/bin/bash
# HuMo 17B Setup Script for RunPod A100 80GB
# Esegui con: bash humo_setup.sh

set -e
echo "=== HuMo 17B Setup ==="

# 1. Install conda
echo "[1/8] Installing Miniconda..."
if ! command -v conda &> /dev/null; then
    wget -q https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh -O /tmp/miniconda.sh
    bash /tmp/miniconda.sh -b -p $HOME/miniconda3
    eval "$($HOME/miniconda3/bin/conda shell.bash hook)"
    conda init bash
    source ~/.bashrc
else
    echo "Conda already installed"
    eval "$(conda shell.bash hook)"
fi

# 2. Create environment
echo "[2/8] Creating conda environment..."
conda create -n humo python=3.11 -y 2>/dev/null || true
conda activate humo

# 3. Install PyTorch
echo "[3/8] Installing PyTorch 2.5.1..."
pip install torch==2.5.1 torchvision==0.20.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cu121 -q

# 4. Clone and setup HuMo
echo "[4/8] Cloning HuMo repo..."
cd ~
if [ ! -d "HuMo" ]; then
    git clone https://github.com/Phantom-video/HuMo.git
fi
cd HuMo

echo "[5/8] Installing dependencies..."
pip install -r requirements.txt -q
pip install flash-attn --no-build-isolation -q
conda install -c conda-forge ffmpeg -y 2>/dev/null || true

# 6. Download models
echo "[6/8] Downloading models (this takes ~10 min)..."
pip install huggingface_hub -q

python3 -c "
from huggingface_hub import hf_hub_download, snapshot_download

print('Downloading HuMo-17B...')
hf_hub_download(repo_id='bytedance-research/HuMo', filename='HuMo-17B/consolidated.00.pth', local_dir='./weights/HuMo')
hf_hub_download(repo_id='bytedance-research/HuMo', filename='zero_vae_129frame.pt', local_dir='./weights/HuMo')
hf_hub_download(repo_id='bytedance-research/HuMo', filename='zero_vae_720p_161frame.pt', local_dir='./weights/HuMo')

print('Downloading Wan2.1-T2V-1.3B...')
snapshot_download(repo_id='Wan-AI/Wan2.1-T2V-1.3B', local_dir='./weights/Wan2.1-T2V-1.3B')

print('Downloading Whisper...')
snapshot_download(repo_id='openai/whisper-large-v3', local_dir='./weights/whisper-large-v3')

print('All models downloaded!')
"

# 7. Apply audio dtype fix
echo "[7/8] Applying audio dtype fix..."
python3 -c "
with open('humo/utils/audio_processor_whisper.py', 'r') as f:
    content = f.read()
content = content.replace(
    'audio_feature = audio_input.to(self.whisper.device).float()',
    'audio_feature = audio_input.to(self.whisper.device).to(next(self.whisper.parameters()).dtype)'
)
with open('humo/utils/audio_processor_whisper.py', 'w') as f:
    f.write(content)
print('Audio dtype fix applied!')
"

# 8. Disable vocal separator in config
echo "[8/8] Configuring..."
sed -i 's|vocal_separator: ./weights/audio_separator/Kim_Vocal_2.onnx|vocal_separator: null|' humo/configs/inference/generate.yaml
sed -i 's|vocal_separator: ./weights/audio_separator/Kim_Vocal_2.onnx|vocal_separator: null|' humo/configs/inference/generate_1_7B.yaml

echo ""
echo "=== SETUP COMPLETE ==="
echo ""
echo "Now upload your image and audio:"
echo "  scp your_image.jpg root@<RUNPOD_IP>:~/HuMo/examples/"
echo "  scp your_audio.mp3 root@<RUNPOD_IP>:~/HuMo/examples/"
echo ""
echo "Then edit test_case.json and run:"
echo "  cd ~/HuMo"
echo "  conda activate humo"
echo "  bash scripts/infer_tia.sh   # 17B 720P"
echo ""
