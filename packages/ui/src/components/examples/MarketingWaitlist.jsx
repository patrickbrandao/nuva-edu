import { Check, Shield, Sparkles, Zap } from 'lucide-react';
import { useId, useState } from 'react';
import { Avatar } from '../core/Avatar';
import { ExampleFeatures, ExampleHead, ExamplePage } from './ExamplePage';

/*
 * Página de lista de espera ("waitlist") de um lançamento: título grande,
 * subtítulo, campo de e-mail com o botão de entrar, a fileira de rostos de
 * quem já entrou com a contagem e, abaixo de um filete, três destaques em
 * laranja. Tudo HTML, CSS e SVG, nos dois temas.
 */

const ICON = { strokeWidth: 1.6, 'aria-hidden': true };

/** Destaques padrão, abaixo do filete. */
export const WAITLIST_FEATURES = [
  {
    title: 'Early Access',
    text: 'Be the first to experience new features before anyone else.',
    icon: <Sparkles {...ICON} />,
  },
  {
    title: 'Lightning Fast',
    text: 'Built for performance from the ground up. No compromises.',
    icon: <Zap {...ICON} />,
  },
  {
    title: 'Private by Default',
    text: 'Your data stays yours. End-to-end encrypted, zero tracking.',
    icon: <Shield {...ICON} />,
  },
];

/** Rostos padrão da fileira — nomes com retrato na folha do Avatar. */
export const WAITLIST_PEOPLE = ['Sam Ortiz', 'Omar Haddad', 'Priya Das', 'Mo Reyes', 'Lena Ruiz'];

/**
 * Página de lista de espera. `onJoin(email)` é chamado ao enviar; se devolver
 * uma Promise, o botão espera por ela, e um erro (rejeição) aparece abaixo do
 * campo. Depois de entrar, o campo vira a confirmação e a contagem soma um.
 */
export function MarketingWaitlist({
  title = 'Something new is coming',
  lead = 'A faster, more thoughtful way to build. Sign up for early access.',
  placeholder = 'you@email.com',
  joinLabel = 'Join Now',
  joiningLabel = 'Joining…',
  joinedMessage = "You're on the list! We'll be in touch.",
  count = 2847,
  countLabel = 'people joined',
  locale = 'pt-BR',
  people = WAITLIST_PEOPLE,
  features = WAITLIST_FEATURES,
  onJoin,
  className,
  style,
}) {
  const id = useId();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('idle'); // idle | joining | joined
  const [error, setError] = useState(null);

  const total = count + (status === 'joined' ? 1 : 0);

  const submit = async (event) => {
    event.preventDefault();
    if (status !== 'idle') return;
    setError(null);
    setStatus('joining');
    try {
      await onJoin?.(email.trim());
      setStatus('joined');
    } catch (err) {
      setError(err?.message || String(err) || 'Something went wrong.');
      setStatus('idle');
    }
  };

  return (
    <ExamplePage variant="minui-waitlist" className={className} style={style}>
      <ExampleHead title={title} lead={lead} />

      {status === 'joined' ? (
        <p className="minui-waitlist__done" role="status">
          <span className="minui-waitlist__check">
            <Check size={14} strokeWidth={2.4} aria-hidden="true" />
          </span>
          {joinedMessage}
        </p>
      ) : (
        <form className="minui-waitlist__form" onSubmit={submit} aria-busy={status === 'joining'}>
          <label htmlFor={`${id}-email`} className="minui-waitlist__sr">
            E-mail
          </label>
          <input
            id={`${id}-email`}
            className="minui-waitlist__input"
            type="email"
            required
            autoComplete="email"
            placeholder={placeholder}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={status === 'joining'}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
          />
          <button className="minui-waitlist__button" type="submit" disabled={status === 'joining'}>
            {status === 'joining' ? joiningLabel : joinLabel}
          </button>
        </form>
      )}
      {error ? (
        <p id={`${id}-error`} className="minui-waitlist__error" role="alert">
          {error}
        </p>
      ) : null}

      {count != null ? (
        <p className="minui-waitlist__social">
          {people?.length ? (
            <span className="minui-waitlist__faces" aria-hidden="true">
              {people.map((name) => (
                <Avatar key={name} name={name} size={30} round className="minui-waitlist__face" />
              ))}
            </span>
          ) : null}
          <span>
            <strong>{total.toLocaleString(locale)}</strong> {countLabel}
          </span>
        </p>
      ) : null}

      <ExampleFeatures features={features} />
    </ExamplePage>
  );
}
