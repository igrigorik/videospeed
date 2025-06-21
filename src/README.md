# Source Code Architecture

This directory contains the modular ES6 architecture that was developed during refactoring.

## Current Implementation

**Active**: `content/inject-simple.js` - Simple, working implementation used in production
- All keyboard shortcuts working (S/D/Z/X/R/G/V)
- Original UI positioning and behavior restored
- Full popup integration
- 11/11 E2E tests passing

## Modular Architecture (Future)

The `core/`, `utils/`, `ui/`, `observers/`, and `site-handlers/` directories contain a complete modular ES6 refactor with:
- Clean separation of concerns
- Comprehensive testing infrastructure
- Modern ES6 module architecture

The modular version (`content/inject.js`) can be activated by updating `manifest.json` to use it instead of `inject-simple.js` once ES6 module loading issues in Chrome extensions are resolved.

## Testing

The `../tests/` directory contains:
- Unit tests for core modules
- Integration tests
- E2E tests with Puppeteer
- All tests verify functionality matches original extension behavior