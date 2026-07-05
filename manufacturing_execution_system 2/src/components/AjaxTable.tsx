import { useState, useEffect } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
} from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import { Search, ChevronLeft, ChevronRight } from 'lucide-react'
import { api } from '../api'
import './AjaxTable.css'

type AjaxTableProps<T> = {
  resource: string
  columns: ColumnDef<T, any>[]
}

export function AjaxTable<T>({ resource, columns }: AjaxTableProps<T>) {
  const [data, setData] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalRows, setTotalRows] = useState(0)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1) // Reset to first page on new search
    }, 500)
    return () => clearTimeout(handler)
  }, [search])

  useEffect(() => {
    let active = true
    setLoading(true)
    api<{ data: T[]; totalPages: number; totalRows: number }>(
      `/api/table/${resource}?page=${page}&limit=10&search=${encodeURIComponent(debouncedSearch)}`
    )
      .then((res) => {
        if (active) {
          setData(res.data)
          setTotalPages(res.totalPages)
          setTotalRows(res.totalRows)
          setLoading(false)
        }
      })
      .catch((err) => {
        console.error(err)
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [resource, page, debouncedSearch])

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: totalPages,
  })

  return (
    <div className="ajax-table-container">
      <div className="ajax-table-header">
        <div className="search-wrapper">
          <Search size={18} className="search-icon" />
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="search-input"
          />
        </div>
        <span className="total-rows-badge">{totalRows} records</span>
      </div>

      <div className="table-responsive">
        <table>
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={`skeleton-${i}`}>
                  {columns.map((_, j) => (
                    <td key={`skeleton-td-${j}`}>
                      <div className="skeleton-loader" />
                    </td>
                  ))}
                </tr>
              ))
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={columns.length} style={{ textAlign: 'center', padding: '2rem' }}>
                  No records found.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="ajax-table-pagination">
        <span className="page-info">
          Page <strong>{page}</strong> of <strong>{totalPages || 1}</strong>
        </span>
        <div className="pagination-controls">
          <button
            type="button"
            className="icon-button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1 || loading}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages || totalPages === 0 || loading}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
    </div>
  )
}
