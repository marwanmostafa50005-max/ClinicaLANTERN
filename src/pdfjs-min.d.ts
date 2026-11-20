// The ready-made small build of pdf.js has no type file of its own.
// It has the same shape as the full build, so it borrows the full build's types.
declare module 'pdfjs-dist/build/pdf.min.mjs' {
  export * from 'pdfjs-dist';
}

declare module 'pdfjs-dist/legacy/build/pdf.mjs' {
  export * from 'pdfjs-dist';
}
