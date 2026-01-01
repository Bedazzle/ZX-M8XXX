# ZX-M8XXX

**Version 0.6.5** | [Changelog](CHANGELOG.md)

ZX-M8XXX (ZX Matrix) is a vanilla JavaScript ZX Spectrum emulator with an integrated debugger designed for reverse engineering and development. No build tools, no dependencies - just open `index.html` in your browser.

## Features

### Emulation
- Full Z80 CPU emulation (all documented + undocumented opcodes)
- 48K, 128K, and Pentagon machine support
- Memory banking and contention emulation
- Pixel-perfect ULA video timing with border effects
- AY-3-8910 sound chip emulation (stereo modes: Mono/ABC/ACB)
- SNA/Z80 snapshot loading/saving
- TAP tape loading with ROM traps (instant load)
- TRD/SCL disk image support (TR-DOS format)
- ZIP archive support
- RZX playback

### Debugger
- Unified breakpoint system (execution, memory read/write, port I/O)
- Execution trace with history navigation (10,000 instructions)
- Memory region marking (code/data/text/graphics)
- Auto memory mapping (detect regions during execution)
- Memory heatmap visualization
- Labels with import/export
- Cross-references (XRefs) tracking
- Bookmarks for quick navigation
- Undo/Redo support
- Pattern search with wildcards
- Project save/load (complete session state)

### Assembler
- Integrated Z80 assembler (sjasmplus-compatible)
- Multi-file projects with virtual file system
- Syntax highlighting
- Search/replace across all files
- Output: SAVEBIN, SAVESNA, SAVETAP
- MD5 checksum verification
- Debug injection at entry point

### Tools
- Graphics Viewer for sprite search
- Memory Watches (up to 10 addresses)
- Text Scanner for string search
- Programmer Calculator (hex/dec/oct/bin)
- Z80 Opcodes reference

## Quick Start

1. Place ROM files in `roms/` directory:
   - `48.rom` - ZX Spectrum 48K (16KB, required)
   - `128.rom` - ZX Spectrum 128K (32KB, optional)
   - `pentagon.rom` - Pentagon 128K (32KB, optional)
   - `trdos.rom` - TR-DOS 5.03/5.04t (16KB, for disk images)
2. Open `index.html` in a modern browser
3. Click **Help** button for comprehensive documentation

## File Formats

| Format | Description |
|--------|-------------|
| SNA | Snapshot (48K/128K) |
| Z80 | Snapshot (v1, v2, v3 with compression) |
| TAP | Tape format (instant load via ROM traps) |
| TRD | TR-DOS disk image |
| SCL | TR-DOS file archive |
| RZX | Input recording |
| ZIP | Archive support |

## Architecture

```
index.html     - UI and main loop
spectrum.js    - Machine integration
z80.js         - Z80 CPU emulation
memory.js      - Memory banking
ula.js         - Video/keyboard
ay.js          - AY-3-8910 sound chip
loaders.js     - File format handlers
disasm.js      - Z80 disassembler
```

## Testing

Open test files directly in browser (no ROM files needed):

- `fuse-test.html` - FUSE Z80 CPU test suite
- `system-test.html` - System tests (memory banking, paging)
- `asm-test.html` - Assembler tests

External test suites (load as TAP/SNA in emulator):

- [ZEXALL](https://mdfs.net/Software/Z80/Exerciser/Spectrum/) - Z80 Instruction Exerciser
- [z80test](https://github.com/raxoft/z80test) - Z80 flags tests (z80ccf, z80doc, z80full, z80memptr)

## Known Limitations

- **Multicolor effects**: 8x2 multicolor engines (Nirvana+, Bifrost) are not fully supported
- **scroll17 left edge**: Minor artifact on left edge during screen bank switching effects

## License

GPL-3.0

## Credits

Based on Z80 documentation and Fuse emulator behavior.

Inspired by: JSSpeccy 3, EmuzWin, Swan, ZXMAK2

## Screenshots

![Debugger View](docs/main_1.png)

![Graphics Viewer](docs/main_2.png)
