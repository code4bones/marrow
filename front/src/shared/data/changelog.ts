// T-context (2026-08-25, owner's ask: "уведомление об обновлении, с
// брифом -- что сделано, если пользователь рефрешнулся... как это и
// принято"): a hand-curated "what's new" feed, independent of package.json
// semver -- there are far more deploys in a day than there are user-facing
// milestones worth announcing, so `id` here is its own incrementing counter,
// bumped only when something is actually worth telling a human about, not
// on every patch release. Newest entry first.
//
// Per D-COMMON-003 (content language matches the human counterpart), this
// content is written directly in Russian -- it's product-facing prose for
// this gateway's actual users, not a UI-chrome label from the translations
// table.
export interface ChangelogEntry {
  id: number;
  date: string;
  title: string;
  items: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    id: 1,
    date: '2026-08-25',
    title: 'Поиск по проекту, дефекты, уведомления в браузере',
    items: [
      'Поиск по всему проекту — строка в шапке Overview: находит задачи, решения, память, дефекты и артефакты по тексту или по id, не покидая текущую страницу.',
      'Раздел «Дефекты» больше не пустой: реальный счётчик, поиск без обязательного слова-фильтра, и связь дефекта с решением, которое его исправило.',
      'Уведомления браузера — включаются в Профиле → Аккаунт, приходят пока открыта вкладка Marrow, без сторонних push-сервисов.',
      'История событий (Events) больше не растёт бесконечно — автоматическая обрезка до последних записей на проект.',
      'Разделены права на удаление: владелец/PM проекта снова может удалять задачи, решения и память без системных админ-прав.',
    ],
  },
];
