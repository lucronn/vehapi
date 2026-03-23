/**
 * Compatibility shim for environments that run this repo below Node 20.
 * The repo targets Node 22, but local tooling can still invoke Node 18.
 */
if (typeof globalThis.File === 'undefined') {
    globalThis.File = class File extends Blob {
        constructor(bits, name, options = {}) {
            super(bits, options);
            this.name = String(name || '');
            this.lastModified = Number(options.lastModified || Date.now());
        }
    };
}
