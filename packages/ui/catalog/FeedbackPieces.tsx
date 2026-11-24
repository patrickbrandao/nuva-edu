import { useState } from 'react';
import {
  AdminButton,
  AdminCard,
  AdminField,
  AdminScope,
  AdminTextArea,
  Alert,
  ConfirmDialog,
  Dialog,
  ImagePicker,
  initialsOf,
  PasswordInput,
  Toast,
  ToastProvider,
  useToast,
} from '../src/index';

/*
 * Diálogo, confirmação, avisos, aviso fixo, campo de senha e seletor de imagem. Cada painel
 * do par monta o diálogo e os avisos dentro de si (`container`), para seguir o tema dele.
 */

function ToastButtons() {
  const toast = useToast();
  return (
    <div className="cat__row">
      <AdminButton onClick={() => toast.success('Perfil salvo.')}>Toast de sucesso</AdminButton>
      <AdminButton
        onClick={() =>
          toast.error('Confira a conexão e tente de novo.', { title: 'Não foi possível salvar' })
        }
      >
        Toast de erro
      </AdminButton>
      <AdminButton
        onClick={() =>
          toast.warning('Sua sessão expira em 5 minutos.', {
            id: 'sessao',
            action: { label: 'Continuar', onClick: () => {} },
          })
        }
      >
        Toast de aviso
      </AdminButton>
    </div>
  );
}

export function FeedbackPieces() {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('SQL do zero');
  const [password, setPassword] = useState('');
  const [current, setCurrent] = useState('');
  const [reason, setReason] = useState('');
  const [terms, setTerms] = useState('');
  const [banner, setBanner] = useState(true);

  const remove = () => {
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      setConfirming(false);
    }, 900);
  };

  return (
    <div ref={setHost}>
      <ToastProvider
        dismissLabel="Dispensar aviso"
        regionLabel="Avisos"
        container={host}
        duration={6000}
      >
        <AdminScope className="cat__stack">
          {banner ? (
            <Alert
              tone="warning"
              layout="banner"
              title="Termos novos publicados"
              actions={
                <AdminButton size="sm" href="#termos">
                  Revisar
                </AdminButton>
              }
              onDismiss={() => setBanner(false)}
              dismissLabel="Fechar aviso"
            >
              Quem entrar no classroom vai precisar aceitar a versão nova.
            </Alert>
          ) : (
            <AdminButton size="sm" onClick={() => setBanner(true)}>
              Mostrar a faixa de novo
            </AdminButton>
          )}
          <Alert tone="info" title="Informação">
            Alert em linha, papel status.
          </Alert>
          <Alert tone="success">Senha trocada. As outras sessões foram encerradas.</Alert>
          <Alert tone="error" title="E-mail ou senha incorretos">
            Alert de erro, papel alert.
          </Alert>

          <div className="cat__row">
            <AdminButton onClick={() => setEditing(true)}>Abrir diálogo</AdminButton>
            <AdminButton onClick={() => setConfirming(true)}>Excluir curso…</AdminButton>
          </div>
          <ToastButtons />
          <Toast tone="success" message="Toast solto, sem região (só para ver)." />

          <AdminCard pad className="cat__stack">
            <PasswordInput
              label="Senha atual"
              value={current}
              onChange={setCurrent}
              autoComplete="current-password"
              showLabel="Mostrar senha"
              hideLabel="Ocultar senha"
            />
            <PasswordInput
              label="Nova senha"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              showLabel="Mostrar senha"
              hideLabel="Ocultar senha"
              hint="De 8 a 128 caracteres."
              error={
                password.length > 0 && password.length < 8 ? 'Use ao menos 8 caracteres.' : null
              }
              counter={({ length, max }) => `${length}/${max}`}
            />
            <AdminTextArea
              label="Motivo"
              value={reason}
              onChange={setReason}
              rows={3}
              maxLength={500}
              hint="Até 500 caracteres. A pessoa vê o motivo ao tentar entrar."
              counter={({ length, max }) => `${length}/${max}`}
            />
            <AdminTextArea
              label="Texto (Markdown)"
              value={terms}
              onChange={setTerms}
              rows={6}
              maxLength={100000}
              error={terms.trim() === '' ? 'Campo obrigatório.' : null}
            />
            <ImagePicker
              label="Foto de perfil"
              chooseLabel="Escolher imagem"
              changeLabel="Trocar imagem"
              removeLabel="Remover"
              limitHint="JPEG, PNG ou WebP, até 5 MB."
              errors={{
                tooLarge: 'A imagem passa de 5 MB. Escolha uma menor.',
                wrongType: 'Use uma imagem JPEG, PNG ou WebP.',
              }}
              previewAlt="Prévia da foto de perfil"
              placeholder={initialsOf('Ana Souza')}
              onChange={() => {}}
              onRemove={() => {}}
            />
          </AdminCard>
        </AdminScope>

        <Dialog
          open={editing}
          onClose={() => setEditing(false)}
          title="Renomear curso"
          description="O endereço do curso não muda."
          closeLabel="Fechar"
          container={host}
          footer={
            <>
              <AdminButton onClick={() => setEditing(false)}>Cancelar</AdminButton>
              <AdminButton variant="primary" onClick={() => setEditing(false)}>
                Salvar
              </AdminButton>
            </>
          }
        >
          <AdminField label="Nome" value={name} onChange={setName} />
        </Dialog>
        <ConfirmDialog
          open={confirming}
          onCancel={() => setConfirming(false)}
          onConfirm={remove}
          title="Excluir o curso?"
          itemName={name}
          message="Os alunos perdem o acesso e o progresso some."
          confirmLabel="Excluir"
          cancelLabel="Cancelar"
          busy={busy}
          busyLabel="Excluindo…"
          typeToConfirmLabel="Digite o nome do curso para confirmar"
          container={host}
        />
      </ToastProvider>
    </div>
  );
}
