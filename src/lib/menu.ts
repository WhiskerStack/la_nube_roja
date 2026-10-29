import menuData from '../data/menu.json';

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  image: string;
  featured?: boolean;
  tag?: string;
}

export interface MenuCategory {
  id: string;
  name: string;
  items: MenuItem[];
}

interface MenuData {
  categories: MenuCategory[];
}

const data = menuData as unknown as MenuData;

export function getMenu(): MenuCategory[] {
  return data.categories;
}

export function getAllItems(): MenuItem[] {
  return data.categories.flatMap((category) => category.items);
}

export function getFeaturedItems(limit = 4): MenuItem[] {
  const featured = getAllItems().filter((item) => item.featured);
  const source = featured.length > 0 ? featured : getAllItems();
  return source.slice(0, limit);
}

export function getImageUrl(fileName: string): string {
  return `/catalog/${fileName}`;
}

export function formatPrice(price: number): string {
  return `$${price.toFixed(2)}`;
}