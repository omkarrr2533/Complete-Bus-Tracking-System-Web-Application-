package com.citybus.config;

import com.github.benmanes.caffeine.cache.Caffeine;
import org.springframework.cache.CacheManager;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.cache.caffeine.CaffeineCache;
import org.springframework.cache.support.SimpleCacheManager;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Duration;
import java.util.List;

/**
 * Per-cache Caffeine policies. Routes change rarely and tolerate long TTLs;
 * the alerts feed must reflect expiry within seconds, so it lives on a short
 * TTL instead of relying purely on write-time eviction.
 */
@Configuration
@EnableCaching
public class CacheConfig {

    @Bean
    public CacheManager cacheManager() {
        SimpleCacheManager manager = new SimpleCacheManager();
        manager.setCaches(List.of(
                new CaffeineCache("routes", Caffeine.newBuilder()
                        .maximumSize(500)
                        .expireAfterWrite(Duration.ofMinutes(10))
                        .recordStats()
                        .build()),
                new CaffeineCache("alerts", Caffeine.newBuilder()
                        .maximumSize(50)
                        .expireAfterWrite(Duration.ofSeconds(30))
                        .recordStats()
                        .build())));
        return manager;
    }
}
