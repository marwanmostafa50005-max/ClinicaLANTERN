/** One static navy bar under the three round icons: Mantle, Lumen, Ogee with their logos. Two arrows show the order of work. */
export function ModelBar() {
  return (
    <div className="model-bar" role="group" aria-label="The three models">
      <div className="model-bar-place" aria-label="Mantle, the model that reads the record and finds">
        <img src="/models/mantle.svg" alt="" width={64} height={64} className="model-bar-logo" />
        <span className="model-bar-name model-bar-name--mantle">MANTLE</span>
        <span className="model-bar-arrow model-bar-arrow--first" aria-hidden="true" />
      </div>
      <div className="model-bar-place" aria-label="Lumen, the model that checks each finding">
        <img src="/models/lumen.svg" alt="" width={64} height={64} className="model-bar-logo" />
        <span className="model-bar-name model-bar-name--lumen">LUMEN</span>
        <span className="model-bar-arrow model-bar-arrow--second" aria-hidden="true" />
      </div>
      <div className="model-bar-place" aria-label="Ogee, the model that writes the letter">
        <img src="/models/ogee.svg" alt="" width={64} height={64} className="model-bar-logo" />
        <span className="model-bar-name model-bar-name--ogee">OGEE</span>
      </div>
    </div>
  );
}