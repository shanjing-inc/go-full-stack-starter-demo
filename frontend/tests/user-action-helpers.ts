import { expect, type Locator, type Page } from "@playwright/test";

export async function openUserActions(page: Page, row: Locator) {
    await row.getByRole("button", { name: /操作菜单$/ }).click();
    await expect(page.getByRole("menu")).toBeVisible();
}

export async function selectUserAction(page: Page, row: Locator, name: string) {
    await openUserActions(page, row);
    await page.getByRole("menuitem", { name, exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
}
