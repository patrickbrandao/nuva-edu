-- 0013: produto criado sem modo de acesso nasce private (spec 009, "Criação e edição", "Modo de
-- acesso inicial"; tarefa 642). Troca o DEFAULT 'open' da 0009 em courses, ebooks e bundles.
-- Só muda o padrão: linhas existentes ficam como estão. O núcleo já grava o modo explicitamente
-- (tarefa 640), então a mudança não altera o comportamento da aplicação sozinha.

-- migrate:up
ALTER TABLE courses ALTER COLUMN access_mode SET DEFAULT 'private';
ALTER TABLE ebooks ALTER COLUMN access_mode SET DEFAULT 'private';
ALTER TABLE bundles ALTER COLUMN access_mode SET DEFAULT 'private';

-- migrate:down
ALTER TABLE courses ALTER COLUMN access_mode SET DEFAULT 'open';
ALTER TABLE ebooks ALTER COLUMN access_mode SET DEFAULT 'open';
ALTER TABLE bundles ALTER COLUMN access_mode SET DEFAULT 'open';
