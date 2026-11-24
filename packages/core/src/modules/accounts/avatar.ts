import type { Database } from '../../db/database.ts';
import { notFound } from '../../errors/domain-error.ts';
import { isImageId } from '../images/image-url.ts';
import { imagePurposeMismatch } from './errors.ts';
import { avatarUrlFor } from './session-view.ts';

// Avatar (spec 007, "Avatar"; spec 029). Dono de `profiles`: classroom-api.

/**
 * `PUT /me/profile/avatar`: associa (ou, com `null`, remove) o avatar. Imagem inexistente,
 * oculta ou de outro usuário: `404`; de outra finalidade: `422 image_purpose_mismatch`. Devolve
 * o novo `avatarUrl`. Recria a linha de `profiles` se faltar.
 */
export async function setAvatar(
  db: Database,
  input: { userId: string; imageId: string | null },
): Promise<{ avatarUrl: string | null }> {
  let imageId: string | null = null;
  if (input.imageId !== null) {
    if (!isImageId(input.imageId)) {
      throw notFound('Imagem não encontrada.');
    }
    const image = await db
      .selectFrom('images')
      .select(['id', 'purpose'])
      .where('id', '=', input.imageId.toLowerCase())
      .where('ownerUserId', '=', input.userId)
      .where('hiddenAt', 'is', null)
      .executeTakeFirst();
    if (!image) {
      throw notFound('Imagem não encontrada.');
    }
    if (image.purpose !== 'avatar') {
      throw imagePurposeMismatch();
    }
    imageId = image.id;
  }
  await db
    .insertInto('profiles')
    .values({ userId: input.userId, avatarImageId: imageId })
    .onConflict((oc) => oc.column('userId').doUpdateSet({ avatarImageId: imageId }))
    .execute();
  return { avatarUrl: avatarUrlFor(imageId) };
}
