package com.citybus.dto;

import org.springframework.data.domain.Page;

import java.util.List;

/**
 * Stable pagination envelope. Wrapping Spring's {@link Page} keeps the wire
 * format under our control instead of leaking framework internals.
 */
public record PageResponse<T>(
        List<T> content,
        int page,
        int size,
        long totalElements,
        int totalPages,
        boolean first,
        boolean last
) {
    public static <T> PageResponse<T> from(Page<T> page) {
        return new PageResponse<>(
                page.getContent(),
                page.getNumber(),
                page.getSize(),
                page.getTotalElements(),
                page.getTotalPages(),
                page.isFirst(),
                page.isLast()
        );
    }
}
