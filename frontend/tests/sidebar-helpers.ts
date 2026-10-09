import { expect, type Page } from "@playwright/test";

export async function signOutFromSidebar(page: Page) {
    await page.getByRole("button", { name: /^用户菜单：/ }).click();
    await expect(page.getByRole("menuitem", { name: "退出", exact: true })).toBeEnabled();
    await page.getByRole("menuitem", { name: "退出", exact: true }).click();
}
