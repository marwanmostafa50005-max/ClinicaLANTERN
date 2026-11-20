/** The name as on the brand sheet: thin navy "Clinica", a golden "L", bold navy "ANTERN". */
export function Wordmark() {
  return (
    <h1 className="wordmark" aria-label="ClinicaLANTERN">
      <span aria-hidden="true" className="wm-clinica">Clinica</span>
      <span aria-hidden="true" className="wm-l">L</span>
      <span aria-hidden="true" className="wm-antern">ANTERN</span>
    </h1>
  );
}
