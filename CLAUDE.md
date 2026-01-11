# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an ID card to PDF converter that provides three interfaces: desktop GUI, command-line, and web application. The core functionality automatically detects ID cards in photos, performs perspective correction, and generates A4 PDFs with true-to-life dimensions (85.6×54.0mm).

## Development Commands

```bash
# Install dependencies
pip install -r requirements.txt

# Run desktop GUI
python idcard2pdf.py

# Run CLI
python idcard2pdf.py --front <front.jpg> --back <back.jpg> --out <output.pdf>

# Run web server (development)
python webserver.py
# Access at http://127.0.0.1:5000/

# Run tests
python test_idcard2pdf.py

# Docker deployment
docker build -t idcard2pdf .
docker run -p 8000:5000 -e PORT=5000 idcard2pdf
```

## Architecture

### Three-Tier Interface Design

The codebase uses a **single-source architecture** where `idcard2pdf.py` contains all core image processing logic that is shared by:

1. **Desktop GUI** - Tkinter-based interface (in `idcard2pdf.py`)
2. **CLI** - Argument-based usage (in `idcard2pdf.py`)
3. **Web API** - Flask server (`webserver.py`) that imports core functions

### Core Processing Pipeline (`idcard2pdf.py`)

The image processing follows this pipeline:

1. **Detection** (`_find_card_quadrilateral`):
   - Resizes image for efficient processing (max dimension: 1000px)
   - Applies Gaussian blur, Canny edge detection, and dilation
   - Finds contours and filters by area and aspect ratio (1.2-2.2 for ID cards)
   - Returns ordered quadrilateral points: `[tl, tr, br, bl]`

2. **Perspective Warp** (`_warp_card`):
   - Orders corner points using sum/difference algorithm
   - Computes homography matrix and applies perspective transform

3. **Refinement** (`extract_idcard`):
   - Optional alpha channel masking to preserve card interior
   - Auto-rotation to landscape orientation (counter-clockwise)
   - Configurable padding to prevent edge clipping

4. **PDF Generation** (`make_a4_pdf`):
   - Places both sides at true dimensions on A4 canvas
   - Uses ReportLab with millimeter-to-point conversion (1mm = 2.83pt)

### Web API Structure (`webserver.py`)

**Endpoints:**
- `GET /` - Serves `web/index.html`
- `POST /api/detect` - Auto-detects card corners, returns fallback box if detection fails
- `POST /api/warp` - Applies perspective transform with user-adjusted quad points
- `POST /api/export` - Generates downloadable PDF from processed images

**Key implementation detail:** The web API re-implements warp logic inline rather than calling `extract_idcard` to support real-time user adjustment of corner points and rotation angle.

### Frontend Architecture (`web/`)

The web interface uses vanilla JavaScript with HTML5 Canvas:

- **Dual-pane editor** - Separate controls for front/back cards
- **Interactive canvas** - Drag corners, zoom/pan, touch gesture support
- **Real-time preview** - Shows A4 layout at actual scale ratio
- **Privacy-focused** - Uses `URL.revokeObjectURL()` to release temporary image URLs immediately after loading

## Key Design Decisions

### Privacy-First Architecture
- All image processing happens in memory
- No files written to disk in web mode
- Frontend releases blob URLs immediately after reading
- Bottom of page explicitly states "Images not saved, deleted after processing"

### Corner Point Ordering
The `_order_pts` function uses a consistent algorithm:
- Top-left: minimum sum of coordinates
- Bottom-right: maximum sum of coordinates
- Top-right: minimum difference (x - y)
- Bottom-left: maximum difference (x - y)

This ordering is critical for perspective transformation and is used consistently across detection and warp operations.

### Aspect Ratio Validation
ID card detection filters contours by aspect ratio (1.2-2.2), which is narrower than the theoretical ID card ratio (~1.585) to account for perspective distortion and detection errors.

### File Reading Strategy
The `_read_bgr` function uses `cv2.imdecode` with `np.fromfile` instead of `cv2.imread` to properly handle Chinese file paths on Windows systems.

## Configuration

- **Max upload size**: 20MB (set in `webserver.py:11`)
- **Processing resize target**: 1000px max dimension (in `idcard2pdf.py:19`)
- **Default padding**: 20px (prevent edge clipping)
- **Landscape rotation**: Counter-clockwise 90° when width < height

## Testing

Tests use synthetic ID card images generated with `cv2.boxPoints` to create rotated rectangles on a colored background. This allows testing without real ID card images.
