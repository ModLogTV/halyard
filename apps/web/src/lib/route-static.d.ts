import '@tanstack/react-router'

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    /** Breadcrumb label as a key under `crumbs` in the `layout` namespace. Dynamic labels come from loader data as `crumb`. */
    crumbKey?: string
  }
}
