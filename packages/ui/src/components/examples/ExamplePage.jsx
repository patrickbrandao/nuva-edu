import '../../styles/tokens.css';
import './examples.css';
import { cx } from '../../lib/util';

/*
 * Peças comuns às páginas de exemplo: a casca (fundo, largura e tokens),
 * o cabeçalho com título grande e subtítulo, e a lista de destaques que fica
 * abaixo do filete.
 */

/** Casca de uma página de exemplo. `variant` vira a classe do tipo de página. */
export function ExamplePage({ variant, className, style, children }) {
  return (
    <section className={cx('minui-expage', variant, className)} style={style}>
      <div className="minui-expage__inner">{children}</div>
    </section>
  );
}

/** Título grande + subtítulo (uma frase ou uma lista de linhas). */
export function ExampleHead({ title, lead }) {
  const lines = Array.isArray(lead) ? lead : lead ? [lead] : [];
  return (
    <header className="minui-expage__head">
      <h1 className="minui-expage__title">{title}</h1>
      {lines.length ? (
        <p className="minui-expage__lead">
          {lines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </p>
      ) : null}
    </header>
  );
}

/** Filete + destaques: [{ title, text, icon }]. Lista vazia não desenha nada. */
export function ExampleFeatures({ features }) {
  if (!features?.length) return null;
  return (
    <>
      <hr className="minui-expage__rule" />
      <ul className="minui-expage__features">
        {features.map((feature) => (
          <li key={feature.title} className="minui-expage__feature">
            <span className="minui-expage__badge">{feature.icon}</span>
            <strong>{feature.title}</strong>
            <span>{feature.text}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
